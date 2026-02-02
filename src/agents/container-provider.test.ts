import { test, expect, describe, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { ContainerProvider } from "./container-provider"

/**
 * Tests for ContainerProvider.
 *
 * These mock Bun.spawn to avoid requiring a real Docker daemon.
 * We verify that the correct docker commands are constructed.
 */

// Helper to capture spawn calls and return fake results
function mockSpawn(
  exitCode: number = 0,
  stdout: string = "",
  stderr: string = "",
) {
  return spyOn(Bun, "spawn").mockImplementation((() => {
    return {
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stdout))
          controller.close()
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stderr))
          controller.close()
        },
      }),
      exited: Promise.resolve(exitCode),
      pid: 1234,
      kill: () => {},
    }
  }) as unknown as typeof Bun.spawn)
}

describe("ContainerProvider", () => {
  let provider: ContainerProvider
  let spawnMock: ReturnType<typeof mockSpawn>

  beforeEach(() => {
    provider = new ContainerProvider()
  })

  afterEach(() => {
    if (spawnMock) {
      spawnMock.mockRestore()
    }
  })

  describe("create", () => {
    test("creates volume and container, returns container ID", async () => {
      const containerId = "abc123def456"
      let callCount = 0
      spawnMock = spyOn(Bun, "spawn").mockImplementation((() => {
        callCount++
        // First call: docker volume create, second call: docker run
        const output = callCount === 1 ? "hearth-vol-agent-1\n" : `${containerId}\n`
        return {
          stdout: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(output))
              controller.close()
            },
          }),
          stderr: new ReadableStream({
            start(controller) {
              controller.close()
            },
          }),
          exited: Promise.resolve(0),
          pid: 1234,
          kill: () => {},
        }
      }) as unknown as typeof Bun.spawn)

      const result = await provider.create("agent-1", "hearth-workspace:python312")

      expect(result).toBe(containerId)
      expect(spawnMock).toHaveBeenCalledTimes(2)

      // Verify volume create command
      const firstCall = spawnMock.mock.calls[0]
      expect(firstCall[0]).toEqual(["bash", "-c", expect.stringContaining("docker volume create")])

      // Verify docker run command
      const secondCall = spawnMock.mock.calls[1]
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
      spawnMock = mockSpawn(0)

      await provider.start("agent-1")

      expect(spawnMock).toHaveBeenCalledTimes(1)
      const cmd = spawnMock.mock.calls[0][0][2] as string
      expect(cmd).toContain("docker start")
      expect(cmd).toContain("hearth-agent-1")
    })
  })

  describe("stop", () => {
    test("calls docker stop with correct container name", async () => {
      spawnMock = mockSpawn(0)

      await provider.stop("agent-1")

      expect(spawnMock).toHaveBeenCalledTimes(1)
      const cmd = spawnMock.mock.calls[0][0][2] as string
      expect(cmd).toContain("docker stop")
      expect(cmd).toContain("hearth-agent-1")
    })
  })

  describe("destroy", () => {
    test("force-removes container and volume", async () => {
      spawnMock = mockSpawn(0)

      await provider.destroy("agent-1")

      expect(spawnMock).toHaveBeenCalledTimes(2)

      const rmCmd = spawnMock.mock.calls[0][0][2] as string
      expect(rmCmd).toContain("docker rm -f")
      expect(rmCmd).toContain("hearth-agent-1")

      const volCmd = spawnMock.mock.calls[1][0][2] as string
      expect(volCmd).toContain("docker volume rm")
      expect(volCmd).toContain("hearth-vol-agent-1")
    })

    test("does not throw if container or volume doesn't exist", async () => {
      spawnMock = mockSpawn(1, "", "No such container")

      // Should not throw
      await provider.destroy("nonexistent")
    })
  })

  describe("getContainerId", () => {
    test("returns container ID when running", async () => {
      spawnMock = mockSpawn(0, "abc123\n")

      const result = await provider.getContainerId("agent-1")
      expect(result).toBe("abc123")
    })

    test("returns null when no container is running", async () => {
      spawnMock = mockSpawn(0, "\n")

      const result = await provider.getContainerId("agent-1")
      expect(result).toBeNull()
    })
  })

  describe("getInfo", () => {
    test("returns container info when container exists", async () => {
      spawnMock = mockSpawn(0, "abc123full python:3.12 true\n")

      const info = await provider.getInfo("agent-1")
      expect(info).toEqual({
        containerId: "abc123full",
        agentId: "agent-1",
        image: "python:3.12",
        status: "running",
      })
    })

    test("returns stopped status for stopped container", async () => {
      spawnMock = mockSpawn(0, "abc123full python:3.12 false\n")

      const info = await provider.getInfo("agent-1")
      expect(info).not.toBeNull()
      expect(info!.status).toBe("stopped")
    })

    test("returns null when container does not exist", async () => {
      spawnMock = mockSpawn(1, "", "No such object")

      const info = await provider.getInfo("nonexistent")
      expect(info).toBeNull()
    })
  })

  describe("list", () => {
    test("returns list of containers", async () => {
      spawnMock = mockSpawn(
        0,
        "abc123 hearth-agent-1 python:3.12 running\ndef456 hearth-agent-2 node:22 exited\n",
      )

      const containers = await provider.list()
      expect(containers).toEqual([
        { containerId: "abc123", agentId: "agent-1", image: "python:3.12", status: "running" },
        { containerId: "def456", agentId: "agent-2", image: "node:22", status: "stopped" },
      ])
    })

    test("returns empty array when no containers exist", async () => {
      spawnMock = mockSpawn(0, "\n")

      const containers = await provider.list()
      expect(containers).toEqual([])
    })
  })

  describe("error handling", () => {
    test("throws on docker command failure", async () => {
      spawnMock = mockSpawn(1, "", "Cannot connect to the Docker daemon")

      await expect(provider.start("agent-1")).rejects.toThrow(
        "Docker command failed",
      )
    })
  })
})
