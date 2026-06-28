import { test, expect, describe } from "bun:test"
import { PersonaStore } from "./persona"

describe("PersonaStore deferral", () => {
  test("setPersona does not change the active persona until activatePending", () => {
    const store = new PersonaStore()
    const original = store.getPersona()

    store.setPersona("New self")
    // Active persona is unchanged this session.
    expect(store.getPersona()).toBe(original)
    // The queued change is visible as pending.
    expect(store.getPendingPersona()).toBe("New self")

    store.activatePending()
    expect(store.getPersona()).toBe("New self")
    expect(store.getPendingPersona()).toBeNull()
  })

  test("setPersona returns the currently-active persona", () => {
    const store = new PersonaStore()
    const prev = store.setPersona("Next")
    expect(prev).toBe(store.getDefaultPersona())
  })

  test("activatePending is a no-op when nothing is queued", () => {
    const store = new PersonaStore()
    const before = store.getPersona()
    store.activatePending()
    expect(store.getPersona()).toBe(before)
  })

  test("resetToDefault is deferred to the next session", () => {
    const store = new PersonaStore()
    store.setPersona("Custom")
    store.activatePending()
    expect(store.isCustomized()).toBe(true)

    store.resetToDefault()
    // Still customized this session; the reset is pending.
    expect(store.isCustomized()).toBe(true)
    expect(store.getPendingPersona()).toBe(store.getDefaultPersona())

    store.activatePending()
    expect(store.isCustomized()).toBe(false)
    expect(store.getPersona()).toBe(store.getDefaultPersona())
  })

  test("getPendingPersona returns null when the queued value equals the active one", () => {
    const store = new PersonaStore()
    store.setPersona(store.getPersona()) // queue the same text
    expect(store.getPendingPersona()).toBeNull()
  })

  test("isCustomized reflects the active persona, not the pending one", () => {
    const store = new PersonaStore()
    store.setPersona("Custom pending")
    expect(store.isCustomized()).toBe(false) // active is still default
    store.activatePending()
    expect(store.isCustomized()).toBe(true)
  })
})
