/**
 * Workspace abstraction for agent file system and command execution.
 * Implementations: LocalWorkspace (host filesystem), ContainerWorkspace (Docker).
 */

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface ExecOptions {
  timeout?: number // ms, default 30_000
  cwd?: string // relative to workspace root
}

export interface DirEntry {
  name: string
  isDirectory: boolean
  size?: number
}

export interface FileStat {
  size: number
  isDirectory: boolean
  mtime: Date
}

export interface Workspace {
  /** Execute a shell command in the workspace. */
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>

  /** Read a file's contents as text. */
  readFile(path: string): Promise<string>

  /** Write content to a file, creating parent directories as needed. */
  writeFile(path: string, content: string): Promise<void>

  /** List entries in a directory. */
  listDir(path: string): Promise<DirEntry[]>

  /** Check if a path exists. */
  exists(path: string): Promise<boolean>

  /** Get file/directory stats. */
  stat(path: string): Promise<FileStat>

  /** The root path of this workspace. */
  readonly root: string
}
