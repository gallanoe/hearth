#!/usr/bin/env bun
/**
 * Seed the library with preloaded books.
 *
 * Downloads a curated set of public-domain classics from Project Gutenberg,
 * plus Claude's Constitution, into assets/books/ as .txt files. The Hearth
 * runtime picks them up on startup via BookStore.loadFromDirectory() — there
 * is no database step; the directory of .txt files *is* the bookshelf.
 *
 * Files are named in kebab-case so they map to clean titles
 * (e.g. "pride-and-prejudice.txt" -> "Pride and Prejudice").
 *
 * Re-runnable: existing files are skipped unless --force is passed.
 *
 *   bun run seed:books           # download anything missing
 *   bun run seed:books --force   # re-download everything
 */

import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// This file lives in scripts/, so the repo root is one level up. The runtime
// loads books from "./assets/books" relative to the repo root, so we write there.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const BOOKS_DIR = join(ROOT, "assets", "books")

interface Source {
  /** kebab-case filename stem; becomes the book's title in the library */
  slug: string
  url: string
  /** Optional cleanup applied to the raw download before saving */
  transform?: (text: string) => string
}

// (Gutenberg ID, kebab-case slug). Slug becomes the title via the loader.
const GUTENBERG: Array<[id: number, slug: string]> = [
  [1342, "pride-and-prejudice"], // Jane Austen
  [2701, "moby-dick"], // Herman Melville
  [84, "frankenstein"], // Mary Shelley
  [76, "adventures-of-huckleberry-finn"], // Mark Twain
  [1661, "adventures-of-sherlock-holmes"], // Arthur Conan Doyle
  [1400, "great-expectations"], // Charles Dickens
  [2600, "war-and-peace"], // Leo Tolstoy
  [2554, "crime-and-punishment"], // Fyodor Dostoyevsky
  [219, "heart-of-darkness"], // Joseph Conrad
  [829, "gullivers-travels"], // Jonathan Swift
]

const SOURCES: Source[] = [
  ...GUTENBERG.map(([id, slug]): Source => ({
    slug,
    url: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    transform: stripGutenbergBoilerplate,
  })),
  {
    slug: "claudes-constitution",
    url: "https://raw.githubusercontent.com/anthropics/claude-constitution/refs/heads/main/20260120-constitution.md",
    transform: stripLeadingToc,
  },
]

/**
 * Strip Project Gutenberg's license header and footer, keeping just the work.
 * Files are wrapped in "*** START OF THE PROJECT GUTENBERG EBOOK ... ***" and
 * a matching "*** END ... ***" line. Falls back to the full text if absent.
 */
function stripGutenbergBoilerplate(text: string): string {
  const start = text.match(/\*\*\*\s*START OF TH(?:E|IS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i)
  const end = text.match(/\*\*\*\s*END OF TH(?:E|IS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i)
  const from = start ? start.index! + start[0].length : 0
  const to = end ? end.index! : text.length
  return text.slice(from, to).trim() + "\n"
}

/**
 * Drop the leading table-of-contents block from the constitution markdown.
 * The document opens with an H1 title, then a run of pure anchor-link lines
 * ("[Section](#section)"), then the body. We keep the title and resume at the
 * first line that isn't blank or a standalone TOC entry. Inline references in
 * body text share their line with other prose, so they are left untouched.
 */
function stripLeadingToc(text: string): string {
  const lines = text.split("\n")
  const tocEntry = /^\s*\[[^\]]+\]\(#[^)]*\)\s*$/
  const out: string[] = []

  let i = 0
  if (lines[0]?.startsWith("# ")) {
    out.push(lines[0], "")
    i = 1
  }
  while (i < lines.length) {
    const line = lines[i] ?? ""
    if (line.trim() !== "" && !tocEntry.test(line)) break
    i++
  }
  out.push(...lines.slice(i))

  return out.join("\n").trim() + "\n"
}

async function fetchText(url: string): Promise<string> {
  // Some Gutenberg mirrors reject requests without a User-Agent.
  const res = await fetch(url, { headers: { "User-Agent": "hearth-seed/1.0" } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return res.text()
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force")
  await mkdir(BOOKS_DIR, { recursive: true })

  let downloaded = 0
  let skipped = 0
  let failed = 0

  for (const source of SOURCES) {
    const dest = join(BOOKS_DIR, `${source.slug}.txt`)

    if (!force && (await Bun.file(dest).exists())) {
      console.log(`⏭️  ${source.slug} (already present)`)
      skipped++
      continue
    }

    try {
      let text = await fetchText(source.url)
      if (source.transform) text = source.transform(text)
      await Bun.write(dest, text)
      console.log(`📥 ${source.slug} (${Math.round(text.length / 1024)} KB)`)
      downloaded++
    } catch (err) {
      console.error(`❌ ${source.slug}: ${err instanceof Error ? err.message : err}`)
      failed++
    }
  }

  console.log(`\n📚 Done — ${downloaded} downloaded, ${skipped} skipped, ${failed} failed.`)
  if (failed > 0) process.exit(1)
}

main()
