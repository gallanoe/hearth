/**
 * Manages Docker container lifecycle for agent workspaces.
 * Each agent gets an isolated container running `sleep infinity`,
 * with a persistent volume for its workspace files.
 */

export interface ContainerInfo {
  containerId: string
  agentId: string
  image: string
  status: "running" | "stopped"
}

export class ContainerProvider {
  /**
   * Create a new container for an agent.
   * Returns the container ID.
   */
  async create(agentId: string, image: string): Promise<string> {
    const containerName = `hearth-${agentId}`
    const volumeName = `hearth-vol-${agentId}`

    await this.run(`docker volume create ${volumeName}`)

    const result = await this.run(
      `docker run -d ` +
      `--name ${shellEscape(containerName)} ` +
      `--hostname ${shellEscape(agentId)} ` +
      `-v ${shellEscape(volumeName)}:/home/agent ` +
      `--memory=512m --cpus=1 ` +
      `${shellEscape(image)} sleep infinity`
    )

    return result.stdout.trim() // container ID
  }

  /** Start a stopped container. */
  async start(agentId: string): Promise<void> {
    await this.run(`docker start ${shellEscape(`hearth-${agentId}`)}`)
  }

  /** Stop a running container. */
  async stop(agentId: string): Promise<void> {
    await this.run(`docker stop ${shellEscape(`hearth-${agentId}`)}`)
  }

  /** Force-remove a container and its volume. */
  async destroy(agentId: string): Promise<void> {
    const containerName = `hearth-${agentId}`
    const volumeName = `hearth-vol-${agentId}`
    await this.run(`docker rm -f ${shellEscape(containerName)}`).catch(() => {})
    await this.run(`docker volume rm ${shellEscape(volumeName)}`).catch(() => {})
  }

  /** Get the container ID for a running agent, or null if not running. */
  async getContainerId(agentId: string): Promise<string | null> {
    const result = await this.run(
      `docker ps -q --filter name=hearth-${agentId}`
    )
    const id = result.stdout.trim()
    return id || null
  }

  /** Get info about an agent's container, or null if it doesn't exist. */
  async getInfo(agentId: string): Promise<ContainerInfo | null> {
    try {
      const result = await this.run(
        `docker inspect --format '{{.Id}} {{.Config.Image}} {{.State.Running}}' ${shellEscape(`hearth-${agentId}`)}`
      )
      const [containerId, image, running] = result.stdout.trim().split(" ")
      return {
        containerId,
        agentId,
        image,
        status: running === "true" ? "running" : "stopped",
      }
    } catch {
      return null
    }
  }

  /** List all hearth containers. */
  async list(): Promise<ContainerInfo[]> {
    const result = await this.run(
      `docker ps -a --filter name=hearth- --format '{{.ID}} {{.Names}} {{.Image}} {{.State}}'`
    )
    if (!result.stdout.trim()) return []

    return result.stdout.trim().split("\n").map((line) => {
      const [containerId, name, image, state] = line.split(" ")
      const agentId = name.replace(/^hearth-/, "")
      return {
        containerId,
        agentId,
        image,
        status: state === "running" ? "running" as const : "stopped" as const,
      }
    })
  }

  /** Run a docker CLI command. Throws on non-zero exit. */
  private async run(command: string) {
    const proc = Bun.spawn(["bash", "-c", command], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      throw new Error(`Docker command failed (exit ${exitCode}): ${stderr}`)
    }
    return { stdout, stderr, exitCode }
  }
}

/** Shell-escape a string for safe use in shell commands. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}
