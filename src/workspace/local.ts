/**
 * Local workspace implementation.
 * Executes commands and accesses files directly on the host filesystem.
 */
import type { Workspace, ExecResult, ExecOptions, DirEntry, FileStat } from "./types"
import { readdir, stat, mkdir } from "node:fs/promises"
import { resolve, join } from "node:path"

export class LocalWorkspace implements Workspace {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    const cwd = opts?.cwd ? this.resolvePath(opts.cwd) : this.root
    const timeout = opts?.timeout ?? 30_000

    const proc = Bun.spawn(["bash", "-c", command], {
      cwd,
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
    return Bun.file(resolved).text()
  }

  async writeFile(path: string, content: string): Promise<void> {
    const resolved = this.resolvePath(path)
    const dir = resolve(resolved, "..")
    await mkdir(dir, { recursive: true })
    await Bun.write(resolved, content)
  }

  async listDir(path: string): Promise<DirEntry[]> {
    const resolved = this.resolvePath(path)
    const entries = await readdir(resolved, { withFileTypes: true })
    const results: DirEntry[] = []
    for (const entry of entries) {
      const entryPath = join(resolved, entry.name)
      try {
        const stats = await stat(entryPath)
        results.push({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: stats.size,
        })
      } catch {
        results.push({ name: entry.name, isDirectory: entry.isDirectory() })
      }
    }
    return results
  }

  async exists(path: string): Promise<boolean> {
    const resolved = this.resolvePath(path)
    return Bun.file(resolved).exists()
  }

  async stat(path: string): Promise<FileStat> {
    const resolved = this.resolvePath(path)
    const stats = await stat(resolved)
    return {
      size: stats.size,
      isDirectory: stats.isDirectory(),
      mtime: stats.mtime,
    }
  }

  /**
   * Resolve a user-provided path against the workspace root.
   * Throws if the result escapes the workspace.
   */
  resolvePath(userPath: string): string {
    const normalized = userPath?.trim() || "."
    const resolved = resolve(this.root, normalized)
    if (!resolved.startsWith(this.root)) {
      throw new Error("Access denied: path outside workspace")
    }
    return resolved
  }
}
