# Hearth — Design Language

> The reference for how the web UI looks and feels. Tokens live in
> [`src/index.css`](src/index.css) (`@theme`); this doc is the _why_.

## Thesis

Hearth is a **window onto a mind living in a house** — an agent that wakes with
a budget of energy, wanders rooms, writes letters, reads, reflects, and sleeps.
The UI is not mission control; it's a **quiet observation deck at night**. Dark
because the house is asleep most of the time. High-contrast because the few
things that matter — _is it awake? what is it thinking? did it write to me?_ —
should arrive like light in a dark room.

**The risk we take:** color is a **vital sign**, not decoration. The interface's
temperature tracks the agent's state — warm when awake, cool and dim when
asleep. Everything else stays quiet so this one idea carries.

## Palette — "firelight in a dark house"

The contrast story is _temperature_, not just light/dark.

| Token                | Hex       | Role                                                     |
| -------------------- | --------- | -------------------------------------------------------- |
| `--color-base`       | `#0A0A0B` | Near-black room — the canvas                             |
| `--color-surface`    | `#141417` | Raised panel — rail, cards                               |
| `--color-surface-2`  | `#1C1C20` | Hover / active                                           |
| `--color-line`       | `#2A2A30` | Hairline structure (we use rules, not boxes)             |
| `--color-text`       | `#F4F3F1` | Primary — warm paper-white, not chrome-white             |
| `--color-muted`      | `#9A9CA4` | Secondary text, labels                                   |
| `--color-ember`      | `#FF8A4C` | **Awake** — firelight; a _glow_, never a fill            |
| `--color-ember-deep` | `#B5462A` | Low end of the ember glow                                |
| `--color-moon`       | `#7C89A6` | **Asleep** — cool, desaturated, quiet                    |
| `--color-alert`      | `#E5654E` | Errors only — leans red so it can't be read as the ember |

Tailwind utilities follow the names: `bg-base`, `text-muted`, `border-line`,
`text-ember`, etc. The ember appears as a glow behind live elements — never as a
bright flat fill on buttons. This is a deliberate departure from the default
"near-black + one neon accent" look: warm, stateful, with a cool counterpart.
The lone exception to "no other colors" is `--color-alert`: errors must read as
_wrong_, and reusing ember (which means _well_) would be a lie. It sits in the
warm family but leans red so the two never blur.

## Typography — two worlds

Type encodes Hearth's core duality: **the machine that houses the mind, and the
mind itself.**

| Role           | Family (`--font-*`)  | Used for                                                                                                       |
| -------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Inhabitant** | `serif` — Newsreader | The agent's voice: letters, reflections, transcripts, big quiet headlines. _Italic_ for the agent's own words. |
| **Instrument** | `sans` — Geist       | Control-room chrome: nav, buttons, labels. Recedes.                                                            |
| **Readout**    | `mono` — Geist Mono  | Telemetry: token counts, timestamps, session #, IDs, uppercase eyebrows. Tabular numerals.                     |

Geist + Geist Mono are one family (the machine); Newsreader is the lone outsider
(the mind). Fonts are self-hosted via `@fontsource-variable/*` — no external
requests, no layout shift.

**Scale (restrained):** display 44–56 / 1.05 · section 22 · body 15–16 / 1.6 for
prose · small 13 · mono caption 12 with `+0.04em` tracking on uppercase eyebrows.
**Radii:** `rounded-panel` (8px) for surfaces, `rounded-control` (6px) for
controls, full circle _only_ for the presence dot.

## Signature: circadian presence

The one memorable element; everything else stays disciplined around it.

- **Awake** — the presence indicator carries an ember halo (`glow-ember`) and a
  slow 4s breath (`animate-breathe`); the active surface picks up a faint warm
  wash (`hearth-glow`). The room feels inhabited.
- **Asleep** — glow gone, indicator goes `moon`, cool and still; the pane dims.
  The room feels dormant.
- It's real-time: SSE drives it, so you watch the house warm up when an agent
  wakes and a message streams in.

## Transcript — voice over instrument

The session transcript is the one place voice and instrument sit side by side, so
the type roles do the sorting. The agent's turns are the **inhabitant** (serif,
under the agent's own name); tool calls are the **instrument** — folded into
collapsed-by-default cards (`ToolCard`, a native `<details>`) so mechanics never
drown the thinking. A collapsed card reads like a sentence (`bash  ls -la`,
`move_to  → office`); expanding reveals arguments and result. A call whose result
hasn't streamed in yet **breathes** the ember dot and reads _running_ — the same
vital sign, applied to a single action. The shell is fixed to the viewport
(`h-dvh`); the rail and transcript scroll independently, and a sticky header keeps
the session number and live state in view through a long scroll.

## Motion

Almost none, by design. The breath on the awake indicator; streamed messages
**settle in** (≈180ms fade + 4px rise) so a live transcript reads like thinking,
not a log. `prefers-reduced-motion` swaps the breath for a static glow and drops
the settle. Restraint here is what keeps it from feeling generated.

## Voice

Copy is design material. Calm, plain, never hype — written from the user's side
of the screen.

- **Status reads as a state of being:** "Awake · in the office", "Asleep · 2h ago".
- **Empty states are invitations:** "No letters yet. Write the first one."
- **Actions keep their name through the flow:** _Wake_ → header reads _Awake_;
  _Write a letter_ → toast _Letter delivered_.
- **Numbers are human:** "1,240 of 50,000 tokens spent", not "token usage".

## Guardrails — what we deliberately avoid

- The default dark look (near-black + single acid-green/vermilion neon accent).
- Inter-everywhere; one sans for everything.
- Decorative `01 / 02 / 03` markers. Numbering is earned only where order is real
  — e.g. session numbers, which _are_ a sequence (set in mono).
- Heavy boxes, drop shadows, gratuitous gradients. The only glow is the hearth.
- Animation for its own sake.
