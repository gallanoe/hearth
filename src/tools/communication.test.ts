import { test, expect, describe } from "bun:test"
import { readInbox, sendMessage } from "./communication"
import { makeTestContext } from "../test-helpers"

function makeContext() {
  return makeTestContext({ currentRoom: "entryway" })
}

describe("readInbox tool", () => {
  test("has correct name", () => {
    expect(readInbox.name).toBe("read_inbox")
  })

  test("returns empty message when no unread letters", async () => {
    const result = await readInbox.execute({}, makeContext())
    expect(result.success).toBe(true)
    expect(result.output).toContain("empty")
  })
})

describe("sendMessage tool", () => {
  test("has correct name", () => {
    expect(sendMessage.name).toBe("send_message")
  })

  test("sends a letter successfully", async () => {
    const result = await sendMessage.execute({ content: "Hello from the agent" }, makeContext())
    expect(result.success).toBe(true)
    expect(result.output).toContain("sent")
  })

  test("rejects empty content", async () => {
    const result = await sendMessage.execute({ content: "" }, makeContext())
    expect(result.success).toBe(false)
    expect(result.output).toContain("empty")
  })

  test("rejects whitespace-only content", async () => {
    const result = await sendMessage.execute({ content: "   " }, makeContext())
    expect(result.success).toBe(false)
  })
})
