import { test, expect, describe } from "bun:test"
import {
  resolvePath,
  truncateOutput,
  formatBytes,
  formatDate,
  isBinaryFile,
  getMimeType,
  WORKSPACE_ROOT,
} from "./utils"

describe("resolvePath", () => {
  test("resolves relative path within workspace", () => {
    const result = resolvePath("notes.txt")
    expect(result).toBe(`${WORKSPACE_ROOT}/notes.txt`)
  })

  test("resolves nested path within workspace", () => {
    const result = resolvePath("subdir/file.txt")
    expect(result).toBe(`${WORKSPACE_ROOT}/subdir/file.txt`)
  })

  test("resolves '.' to workspace root", () => {
    const result = resolvePath(".")
    expect(result).toBe(WORKSPACE_ROOT)
  })

  test("resolves empty string to workspace root", () => {
    const result = resolvePath("")
    expect(result).toBe(WORKSPACE_ROOT)
  })

  test("resolves whitespace-only to workspace root", () => {
    const result = resolvePath("   ")
    expect(result).toBe(WORKSPACE_ROOT)
  })

  test("throws on path traversal outside workspace", () => {
    expect(() => resolvePath("../../etc/passwd")).toThrow("Access denied: path outside workspace")
  })

  test("throws on absolute path outside workspace", () => {
    expect(() => resolvePath("/etc/passwd")).toThrow("Access denied: path outside workspace")
  })
})

describe("truncateOutput", () => {
  test("returns content unchanged when under limit", () => {
    expect(truncateOutput("hello", 100)).toBe("hello")
  })

  test("returns content unchanged when exactly at limit", () => {
    expect(truncateOutput("hello", 5)).toBe("hello")
  })

  test("truncates with notice when over limit", () => {
    const result = truncateOutput("hello world", 5)
    expect(result).toContain("hello")
    expect(result).toContain("truncated")
    expect(result).toContain("5")
    expect(result).toContain("11")
  })
})

describe("formatBytes", () => {
  test("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B")
  })

  test("formats bytes", () => {
    expect(formatBytes(500)).toBe("500 B")
  })

  test("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB")
  })

  test("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB")
  })

  test("formats gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB")
  })

  test("formats fractional values", () => {
    expect(formatBytes(1536)).toBe("1.5 KB")
  })
})

describe("formatDate", () => {
  test("formats a date as YYYY-MM-DD HH:MM", () => {
    const date = new Date("2024-06-15T14:30:45.000Z")
    expect(formatDate(date)).toBe("2024-06-15 14:30")
  })
})

describe("isBinaryFile", () => {
  test("detects image files as binary", () => {
    expect(isBinaryFile("photo.png")).toBe(true)
    expect(isBinaryFile("photo.jpg")).toBe(true)
    expect(isBinaryFile("photo.gif")).toBe(true)
  })

  test("detects archive files as binary", () => {
    expect(isBinaryFile("archive.zip")).toBe(true)
    expect(isBinaryFile("archive.tar")).toBe(true)
  })

  test("detects executable files as binary", () => {
    expect(isBinaryFile("program.exe")).toBe(true)
    expect(isBinaryFile("lib.so")).toBe(true)
  })

  test("returns false for text files", () => {
    expect(isBinaryFile("readme.txt")).toBe(false)
    expect(isBinaryFile("code.ts")).toBe(false)
    expect(isBinaryFile("style.css")).toBe(false)
  })

  test("handles uppercase extensions", () => {
    expect(isBinaryFile("PHOTO.PNG")).toBe(true)
  })
})

describe("getMimeType", () => {
  test("returns correct mime for known types", () => {
    expect(getMimeType("file.png")).toBe("image/png")
    expect(getMimeType("file.json")).toBe("application/json")
    expect(getMimeType("file.mp4")).toBe("video/mp4")
    expect(getMimeType("file.pdf")).toBe("application/pdf")
  })

  test("returns octet-stream for unknown types", () => {
    expect(getMimeType("file.xyz")).toBe("application/octet-stream")
    expect(getMimeType("file.ts")).toBe("application/octet-stream")
  })
})
