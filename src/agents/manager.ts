import { createAgentState, type AgentState } from "./state"
import { ContainerProvider } from "./container-provider"
import { ContainerWorkspace } from "../workspace/container"
import { LocalWorkspace } from "../workspace/local"
import { USE_CONTAINERS, CONTAINER_IMAGE, WORKSPACE_ROOT } from "../config"
import type { SessionResult } from "../core/loop"
import { mkdir } from "node:fs/promises"

interface ManagedAgent {
  state: AgentState
  isRunning: boolean
  lastResult: SessionResult | null
}

export interface AgentManagerOptions {
  /** Provide a ContainerProvider, or null to force local workspaces. Defaults to config. */
  containerProvider?: ContainerProvider | null
  /** Override the workspace root directory. Defaults to config. */
  workspaceRoot?: string
}

export class AgentManager {
  private agents = new Map<string, ManagedAgent>()
  private containerProvider: ContainerProvider | null
  private workspaceRoot: string

  constructor(options: AgentManagerOptions = {}) {
    if (options.containerProvider !== undefined) {
      this.containerProvider = options.containerProvider
    } else {
      this.containerProvider = USE_CONTAINERS ? new ContainerProvider() : null
    }
    this.workspaceRoot = options.workspaceRoot ?? WORKSPACE_ROOT
  }

  /**
   * Create a new agent with its own workspace, stores, and room registry.
   * Container workspace is created eagerly if containers are enabled.
   */
  async createAgent(agentId: string): Promise<AgentState> {
    if (this.agents.has(agentId)) {
      throw new Error(`Agent already exists: ${agentId}`)
    }

    let workspace
    if (this.containerProvider) {
      // Check if container already exists (e.g. from a previous run)
      let containerId = await this.containerProvider.getContainerId(agentId)
      if (!containerId) {
        const info = await this.containerProvider.getInfo(agentId)
        if (info) {
          await this.containerProvider.start(agentId)
          containerId = info.containerId
        } else {
          containerId = await this.containerProvider.create(agentId, CONTAINER_IMAGE)
        }
      }
      workspace = new ContainerWorkspace(containerId, this.workspaceRoot)
      console.log(`🐳 Container workspace for ${agentId}: ${containerId.slice(0, 12)}`)
    } else {
      const root = `${this.workspaceRoot}/${agentId}`
      await mkdir(root, { recursive: true })
      workspace = new LocalWorkspace(root)
    }

    const state = await createAgentState(agentId, workspace)
    this.agents.set(agentId, { state, isRunning: false, lastResult: null })

    return state
  }

  getState(agentId: string): AgentState | undefined {
    return this.agents.get(agentId)?.state
  }

  isRunning(agentId: string): boolean {
    return this.agents.get(agentId)?.isRunning ?? false
  }

  getLastResult(agentId: string): SessionResult | null {
    return this.agents.get(agentId)?.lastResult ?? null
  }

  setRunning(agentId: string, running: boolean): void {
    const entry = this.agents.get(agentId)
    if (entry) entry.isRunning = running
  }

  setLastResult(agentId: string, result: SessionResult): void {
    const entry = this.agents.get(agentId)
    if (entry) entry.lastResult = result
  }

  async destroyAgent(agentId: string): Promise<void> {
    this.agents.delete(agentId)
    if (this.containerProvider) {
      await this.containerProvider.destroy(agentId)
    }
  }

  listAgents(): Array<{ agentId: string; isRunning: boolean }> {
    return Array.from(this.agents.entries()).map(([agentId, entry]) => ({
      agentId,
      isRunning: entry.isRunning,
    }))
  }
}
