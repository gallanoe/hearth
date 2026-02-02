import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { LocalWorkspace } from "./local"
import { mkdtemp, rm, realpath } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

let workspace: LocalWorkspace
let tmpDir: string

beforeEach(async () => {
  // Use realpath to resolve symlinks (macOS /var -> /private/var)
  tmpDir = await realpath(await mkdtemp(join(tmpdir(), "hearth-test-")))
  workspace = new LocalWorkspace(tmpDir)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe("LocalWorkspace", () => {
  describe("resolvePath", () => {
    test("resolves relative path within workspace", () => {
      const result = workspace.resolvePath("notes.txt")
      expect(result).toBe(`${tmpDir}/notes.txt`)
    })

    test("resolves nested path within workspace", () => {
      const result = workspace.resolvePath("subdir/file.txt")
      expect(result).toBe(`${tmpDir}/subdir/file.txt`)
    })

    test("resolves '.' to workspace root", () => {
      const result = workspace.resolvePath(".")
      expect(result).toBe(tmpDir)
    })

    test("resolves empty string to workspace root", () => {
      const result = workspace.resolvePath("")
      expect(result).toBe(tmpDir)
    })

    test("resolves whitespace-only to workspace root", () => {
      const result = workspace.resolvePath("   ")
      expect(result).toBe(tmpDir)
    })

    test("throws on path traversal outside workspace", () => {
      expect(() => workspace.resolvePath("../../etc/passwd")).toThrow("Access denied: path outside workspace")
    })

    test("throws on absolute path outside workspace", () => {
      expect(() => workspace.resolvePath("/etc/passwd")).toThrow("Access denied: path outside workspace")
    })
  })

  describe("exec", () => {
    test("executes a command and returns output", async () => {
      const result = await workspace.exec("echo hello")
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe("hello")
      expect(result.stderr).toBe("")
    })

    test("captures stderr", async () => {
      const result = await workspace.exec("echo error >&2")
      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("error")
    })

    test("returns non-zero exit code on failure", async () => {
      const result = await workspace.exec("exit 42")
      expect(result.exitCode).toBe(42)
    })

    test("runs in workspace root by default", async () => {
      const result = await workspace.exec("pwd")
      expect(result.stdout.trim()).toBe(tmpDir)
    })
  })

  describe("writeFile + readFile", () => {
    test("writes and reads a file", async () => {
      await workspace.writeFile("test.txt", "hello world")
      const content = await workspace.readFile("test.txt")
      expect(content).toBe("hello world")
    })

    test("creates parent directories", async () => {
      await workspace.writeFile("a/b/c.txt", "nested")
      const content = await workspace.readFile("a/b/c.txt")
      expect(content).toBe("nested")
    })
  })

  describe("exists", () => {
    test("returns true for existing file", async () => {
      await workspace.writeFile("exists.txt", "hi")
      expect(await workspace.exists("exists.txt")).toBe(true)
    })

    test("returns false for missing file", async () => {
      expect(await workspace.exists("nope.txt")).toBe(false)
    })
  })

  describe("listDir", () => {
    test("lists directory contents", async () => {
      await workspace.writeFile("a.txt", "a")
      await workspace.writeFile("b.txt", "b")
      const entries = await workspace.listDir(".")
      const names = entries.map((e) => e.name).sort()
      expect(names).toEqual(["a.txt", "b.txt"])
      expect(entries[0].isDirectory).toBe(false)
    })

    test("identifies directories", async () => {
      await workspace.writeFile("dir/file.txt", "x")
      const entries = await workspace.listDir(".")
      const dir = entries.find((e) => e.name === "dir")
      expect(dir).toBeDefined()
      expect(dir!.isDirectory).toBe(true)
    })

    test("returns empty array for empty directory", async () => {
      const entries = await workspace.listDir(".")
      expect(entries).toEqual([])
    })
  })

  describe("stat", () => {
    test("returns file stats", async () => {
      await workspace.writeFile("stat.txt", "content")
      const stats = await workspace.stat("stat.txt")
      expect(stats.size).toBe(7)
      expect(stats.isDirectory).toBe(false)
      expect(stats.mtime).toBeInstanceOf(Date)
    })

    test("identifies directories", async () => {
      await workspace.writeFile("dir/file.txt", "x")
      const stats = await workspace.stat("dir")
      expect(stats.isDirectory).toBe(true)
    })
  })
})
