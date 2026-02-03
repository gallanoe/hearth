import { test, expect, describe, afterEach, afterAll } from "bun:test"
import { AgentManager } from "./manager"
import type { SessionResult } from "../core/loop"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TEST_WORKSPACE_ROOT = join(tmpdir(), "hearth-test-workspaces")

/**
 * Tests for AgentManager.
 *
 * These use real LocalWorkspace instances (no containers).
 * We explicitly pass containerProvider: null to ensure local workspaces
 * are used regardless of the USE_CONTAINERS environment variable.
 */

describe("AgentManager", () => {
  const createdAgentIds: string[] = []

  afterEach(async () => {
    // Clean up workspace directories
    for (const id of createdAgentIds) {
      await rm(join(TEST_WORKSPACE_ROOT, id), { recursive: true, force: true }).catch(() => {})
    }
    createdAgentIds.length = 0
  })

  afterAll(async () => {
    await rm(TEST_WORKSPACE_ROOT, { recursive: true, force: true }).catch(() => {})
  })

  function trackAgent(id: string) {
    createdAgentIds.push(id)
    return id
  }

  function createManager() {
    return new AgentManager({ containerProvider: null, workspaceRoot: TEST_WORKSPACE_ROOT })
  }

  test("createAgent returns AgentState and registers agent", async () => {
    const manager = createManager()
    const id = trackAgent("test-create")

    const state = await manager.createAgent(id)

    expect(state.agentId).toBe(id)
    expect(state.stores).toBeDefined()
    expect(state.roomRegistry).toBeDefined()
    expect(manager.getState(id)).toBe(state)
  })

  test("createAgent throws if agent already exists", async () => {
    const manager = createManager()
    const id = trackAgent("test-duplicate")

    await manager.createAgent(id)

    expect(manager.createAgent(id)).rejects.toThrow("Agent already exists: test-duplicate")
  })

  test("isRunning defaults to false", async () => {
    const manager = createManager()
    const id = trackAgent("test-running")

    await manager.createAgent(id)

    expect(manager.isRunning(id)).toBe(false)
  })

  test("isRunning returns false for unknown agent", () => {
    const manager = createManager()
    expect(manager.isRunning("nonexistent")).toBe(false)
  })

  test("setRunning updates the running state", async () => {
    const manager = createManager()
    const id = trackAgent("test-set-running")

    await manager.createAgent(id)

    manager.setRunning(id, true)
    expect(manager.isRunning(id)).toBe(true)

    manager.setRunning(id, false)
    expect(manager.isRunning(id)).toBe(false)
  })

  test("getLastResult defaults to null", async () => {
    const manager = createManager()
    const id = trackAgent("test-last-result")

    await manager.createAgent(id)

    expect(manager.getLastResult(id)).toBeNull()
  })

  test("setLastResult stores the result", async () => {
    const manager = createManager()
    const id = trackAgent("test-set-result")

    await manager.createAgent(id)

    const fakeResult: SessionResult = {
      sessionNumber: 1,
      endReason: "sleep",
      totalTokensUsed: 5000,
      totalCost: 0.01,
      turns: [],
      sessionSummary: "Agent did some work.",
    }

    manager.setLastResult(id, fakeResult)
    expect(manager.getLastResult(id)).toBe(fakeResult)
  })

  test("listAgents returns all agents with running state", async () => {
    const manager = createManager()
    const id1 = trackAgent("test-list-1")
    const id2 = trackAgent("test-list-2")

    await manager.createAgent(id1)
    await manager.createAgent(id2)
    manager.setRunning(id2, true)

    const agents = manager.listAgents()

    expect(agents).toHaveLength(2)
    expect(agents.find((a) => a.agentId === id1)?.isRunning).toBe(false)
    expect(agents.find((a) => a.agentId === id2)?.isRunning).toBe(true)
  })

  test("destroyAgent removes agent from map", async () => {
    const manager = createManager()
    const id = trackAgent("test-destroy")

    await manager.createAgent(id)
    expect(manager.getState(id)).toBeDefined()

    await manager.destroyAgent(id)
    expect(manager.getState(id)).toBeUndefined()
    expect(manager.listAgents()).toHaveLength(0)
  })

  test("getState returns undefined for unknown agent", () => {
    const manager = createManager()
    expect(manager.getState("ghost")).toBeUndefined()
  })

  test("multiple agents have independent stores", async () => {
    const manager = createManager()
    const id1 = trackAgent("test-iso-1")
    const id2 = trackAgent("test-iso-2")

    const state1 = await manager.createAgent(id1)
    const state2 = await manager.createAgent(id2)

    state1.stores.letters.addInbound("Private message for agent 1")

    expect(state1.stores.letters.getUnreadCount()).toBe(1)
    expect(state2.stores.letters.getUnreadCount()).toBe(0)
  })
})
