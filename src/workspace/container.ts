/**
 * Container workspace implementation.
 * All operations go through `docker exec` into a running container.
 */
import type { Workspace, ExecResult, ExecOptions, DirEntry, FileStat } from "./types"

export class ContainerWorkspace implements Workspace {
  readonly root: string

  constructor(
    private containerId: string,
    root: string = "/home/agent",
  ) {
    this.root = root
  }

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    const cwd = opts?.cwd
      ? this.resolvePath(opts.cwd)
      : this.root
    const timeout = opts?.timeout ?? 30_000

    const dockerCmd = [
      "docker", "exec",
      "-w", cwd,
      this.containerId,
      "bash", "-c", command,
    ]

    const proc = Bun.spawn(dockerCmd, {
      timeout,
      stdout: "pipe",
      stderr: "pipe",
    })

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited
    return { exitCode, stdout, stderr }
  }

  async readFile(path: string): Promise<string> {
    const resolved = this.resolvePath(path)
    const result = await this.exec(`cat ${shellEscape(resolved)}`)
    if (result.exitCode !== 0) {
      throw new Error(`readFile failed: ${result.stderr}`)
    }
    return result.stdout
  }

  async writeFile(path: string, content: string): Promise<void> {
    const resolved = this.resolvePath(path)
    const dir = resolved.substring(0, resolved.lastIndexOf("/"))
    await this.exec(`mkdir -p ${shellEscape(dir)}`)

    // Pipe content via stdin to avoid shell escaping issues with file content
    const dockerCmd = [
      "docker", "exec", "-i",
      "-w", this.root,
      this.containerId,
      "bash", "-c", `cat > ${shellEscape(resolved)}`,
    ]
    const proc = Bun.spawn(dockerCmd, {
      stdin: new Blob([content]),
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`writeFile failed: ${stderr}`)
    }
  }

  async listDir(path: string): Promise<DirEntry[]> {
    const resolved = this.resolvePath(path)
    const result = await this.exec(
      `find ${shellEscape(resolved)} -maxdepth 1 -not -path ${shellEscape(resolved)} -printf '%y %s %f\\n'`,
    )
    if (result.exitCode !== 0) {
      throw new Error(`listDir failed: ${result.stderr}`)
    }
    if (!result.stdout.trim()) return []

    return result.stdout.trim().split("\n").map((line) => {
      const [type, size, ...nameParts] = line.split(" ")
      return {
        name: nameParts.join(" "),
        isDirectory: type === "d",
        size: parseInt(size, 10),
      }
    })
  }

  async exists(path: string): Promise<boolean> {
    const resolved = this.resolvePath(path)
    const result = await this.exec(`test -e ${shellEscape(resolved)}`)
    return result.exitCode === 0
  }

  async stat(path: string): Promise<FileStat> {
    const resolved = this.resolvePath(path)
    const result = await this.exec(
      `stat -c '%s %F %Y' ${shellEscape(resolved)}`,
    )
    if (result.exitCode !== 0) {
      throw new Error(`stat failed: ${result.stderr}`)
    }
    const parts = result.stdout.trim().split(" ")
    const size = parseInt(parts[0], 10)
    const type = parts.slice(1, -1).join(" ") // "regular file" or "directory"
    const mtime = parseInt(parts[parts.length - 1], 10)

    return {
      size,
      isDirectory: type === "directory",
      mtime: new Date(mtime * 1000),
    }
  }

  /**
   * Resolve a user-provided path against the workspace root.
   */
  private resolvePath(userPath: string): string {
    const normalized = userPath?.trim() || "."
    if (normalized.startsWith("/")) return normalized
    return `${this.root}/${normalized}`
  }
}

/** Shell-escape a string for safe use in shell commands. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}
