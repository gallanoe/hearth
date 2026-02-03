import { test, expect, describe, beforeEach, mock } from "bun:test"
import { ContainerProvider } from "./container-provider"

/**
 * Tests for ContainerProvider.
 *
 * Uses dependency injection to mock spawn and avoid requiring a real Docker daemon.
 * We verify that the correct docker commands are constructed.
 */

// Helper to create a mock spawn function that records calls
function createMockSpawn(
  exitCode: number | ((callIndex: number) => number) = 0,
  stdout: string | ((callIndex: number) => string) = "",
  stderr: string | ((callIndex: number) => string) = "",
) {
  let callCount = 0
  const calls: Array<[string[], object]> = []

  const mockFn = ((args: string[], opts: object) => {
    const currentCall = callCount++
    calls.push([args, opts])

    const code = typeof exitCode === "function" ? exitCode(currentCall) : exitCode
    const out = typeof stdout === "function" ? stdout(currentCall) : stdout
    const err = typeof stderr === "function" ? stderr(currentCall) : stderr

    return {
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(out))
          controller.close()
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(err))
          controller.close()
        },
      }),
      exited: Promise.resolve(code),
      pid: 1234,
      kill: () => {},
    }
  }) as unknown as typeof Bun.spawn

  return { mockFn, calls }
}

describe("ContainerProvider", () => {
  describe("create", () => {
    test("creates volume and container, returns container ID", async () => {
      const containerId = "abc123def456"
      const { mockFn, calls } = createMockSpawn(
        0,
        (i) => i === 0 ? "hearth-vol-agent-1\n" : `${containerId}\n`,
      )
      const provider = new ContainerProvider(mockFn)

      const result = await provider.create("agent-1", "hearth-workspace:python312")

      expect(result).toBe(containerId)
      expect(calls.length).toBe(2)

      // Verify volume create command
      const firstCall = calls[0]
      expect(firstCall[0]).toEqual(["bash", "-c", expect.stringContaining("docker volume create")])

      // Verify docker run command
      const secondCall = calls[1]
      const runCmd = secondCall[0][2] as string
      expect(runCmd).toContain("docker run -d")
      expect(runCmd).toContain("hearth-agent-1")
      expect(runCmd).toContain("hearth-vol-agent-1")
      expect(runCmd).toContain("--memory=512m")
      expect(runCmd).toContain("--cpus=1")
      expect(runCmd).toContain("sleep infinity")
    })
  })

  describe("start", () => {
    test("calls docker start with correct container name", async () => {
      const { mockFn, calls } = createMockSpawn(0)
      const provider = new ContainerProvider(mockFn)

      await provider.start("agent-1")

      expect(calls.length).toBe(1)
      const cmd = calls[0][0][2] as string
      expect(cmd).toContain("docker start")
      expect(cmd).toContain("hearth-agent-1")
    })
  })

  describe("stop", () => {
    test("calls docker stop with correct container name", async () => {
      const { mockFn, calls } = createMockSpawn(0)
      const provider = new ContainerProvider(mockFn)

      await provider.stop("agent-1")

      expect(calls.length).toBe(1)
      const cmd = calls[0][0][2] as string
      expect(cmd).toContain("docker stop")
      expect(cmd).toContain("hearth-agent-1")
    })
  })

  describe("destroy", () => {
    test("force-removes container and volume", async () => {
      const { mockFn, calls } = createMockSpawn(0)
      const provider = new ContainerProvider(mockFn)

      await provider.destroy("agent-1")

      expect(calls.length).toBe(2)

      const rmCmd = calls[0][0][2] as string
      expect(rmCmd).toContain("docker rm -f")
      expect(rmCmd).toContain("hearth-agent-1")

      const volCmd = calls[1][0][2] as string
      expect(volCmd).toContain("docker volume rm")
      expect(volCmd).toContain("hearth-vol-agent-1")
    })

    test("does not throw if container or volume doesn't exist", async () => {
      const { mockFn } = createMockSpawn(1, "", "No such container")
      const provider = new ContainerProvider(mockFn)

      // Should not throw
      await provider.destroy("nonexistent")
    })
  })

  describe("getContainerId", () => {
    test("returns container ID when running", async () => {
      const { mockFn } = createMockSpawn(0, "abc123\n")
      const provider = new ContainerProvider(mockFn)

      const result = await provider.getContainerId("agent-1")
      expect(result).toBe("abc123")
    })

    test("returns null when no container is running", async () => {
      const { mockFn } = createMockSpawn(0, "\n")
      const provider = new ContainerProvider(mockFn)

      const result = await provider.getContainerId("agent-1")
      expect(result).toBeNull()
    })
  })

  describe("getInfo", () => {
    test("returns container info when container exists", async () => {
      const { mockFn } = createMockSpawn(0, "abc123full python:3.12 true\n")
      const provider = new ContainerProvider(mockFn)

      const info = await provider.getInfo("agent-1")
      expect(info).toEqual({
        containerId: "abc123full",
        agentId: "agent-1",
        image: "python:3.12",
        status: "running",
      })
    })

    test("returns stopped status for stopped container", async () => {
      const { mockFn } = createMockSpawn(0, "abc123full python:3.12 false\n")
      const provider = new ContainerProvider(mockFn)

      const info = await provider.getInfo("agent-1")
      expect(info).not.toBeNull()
      expect(info!.status).toBe("stopped")
    })

    test("returns null when container does not exist", async () => {
      const { mockFn } = createMockSpawn(1, "", "No such object")
      const provider = new ContainerProvider(mockFn)

      const info = await provider.getInfo("nonexistent")
      expect(info).toBeNull()
    })
  })

  describe("list", () => {
    test("returns list of containers", async () => {
      const { mockFn } = createMockSpawn(
        0,
        "abc123 hearth-agent-1 python:3.12 running\ndef456 hearth-agent-2 node:22 exited\n",
      )
      const provider = new ContainerProvider(mockFn)

      const containers = await provider.list()
      expect(containers).toEqual([
        { containerId: "abc123", agentId: "agent-1", image: "python:3.12", status: "running" },
        { containerId: "def456", agentId: "agent-2", image: "node:22", status: "stopped" },
      ])
    })

    test("returns empty array when no containers exist", async () => {
      const { mockFn } = createMockSpawn(0, "\n")
      const provider = new ContainerProvider(mockFn)

      const containers = await provider.list()
      expect(containers).toEqual([])
    })
  })

  describe("error handling", () => {
    test("throws on docker command failure", async () => {
      const { mockFn } = createMockSpawn(1, "", "Cannot connect to the Docker daemon")
      const provider = new ContainerProvider(mockFn)

      await expect(provider.start("agent-1")).rejects.toThrow(
        "Docker command failed",
      )
    })
  })
})
