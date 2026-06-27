import { test, expect, describe } from "bun:test"
import { withTurnSpan, withToolSpan } from "./traced-provider"

// These run with tracing disabled (no LANGFUSE_* env / startObservability never
// called), so the spans are non-recording no-ops. The contract under test is that
// the helpers still invoke their bodies, return the body's value, and expose the
// handle methods — i.e. the loop behaves identically whether or not Langfuse is on.
describe("withTurnSpan / withToolSpan with tracing disabled", () => {
  test("withTurnSpan runs the body and returns its value", async () => {
    let ran = false
    const result = await withTurnSpan({ turn: 1, room: "bedroom" }, async (span) => {
      span.setInput("What would you like to do?")
      span.setMetadata({ extra: true })
      span.setOutput({ ok: 1 })
      ran = true
      return 42
    })
    expect(result).toBe(42)
    expect(ran).toBe(true)
  })

  test("withToolSpan runs the body, returns its value, and exposes setOutput/setError", async () => {
    const result = await withToolSpan({ name: "bash", input: { cmd: "ls" } }, async (span) => {
      span.setOutput("done")
      span.setError("would-be error")
      return { success: true, output: "done" }
    })
    expect(result.output).toBe("done")
  })

  test("tool spans nest inside a turn span and propagate values", async () => {
    const order: string[] = []
    const out = await withTurnSpan({ turn: 2, room: "office" }, async () => {
      const a = await withToolSpan({ name: "ls" }, async () => {
        order.push("ls")
        return "a"
      })
      const b = await withToolSpan({ name: "bash" }, async () => {
        order.push("bash")
        return "b"
      })
      return [a, b]
    })
    expect(out).toEqual(["a", "b"])
    expect(order).toEqual(["ls", "bash"])
  })

  test("an error thrown in a tool body propagates out", async () => {
    await expect(
      withTurnSpan({ turn: 3, room: "library" }, async () =>
        withToolSpan({ name: "boom" }, async () => {
          throw new Error("kaboom")
        })
      )
    ).rejects.toThrow("kaboom")
  })
})
