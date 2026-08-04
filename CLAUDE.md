# set-atlas — project instructions

**A generated, compact map of a running app's UI, for AI agents that have to design on it.**

Extracted from the `consumer-a` project on 2026-08-04, where the problem was measured:
an ajánlat (quote) feature shipped redundantly and unreachable from the obvious place,
and nobody noticed until a human clicked through the UI. Spec-driven development had
become good at describing *what* to build and stayed blind to *where it goes*.

## Language

Code, comments, README, commit messages, CLI output: **English** — this is a public
package. Working notes under `docs/` and conversation with the user: **Hungarian**
(the user's language; full diacritics, never ASCII substitutes).

## The three principles — do not weaken these

1. **Generated, never hand-maintained.** A stale UI description is worse than none,
   because planning silently builds on it. If a field cannot be generated, it does not
   belong in the output.
2. **The atlas does not replace reading the code.** Stated by the user, 2026-08-04: *"the
   atlas cannot replace reviewing the TypeScript and the UI code — it helps with visual
   understanding, planning and orientation."* It is a snapshot of the rendered DOM, so it
   cannot see server-side scope (`where` clauses, query filters), state, or call chains.
   Measured the same day: of ten findings a review agent produced from the atlas, two had
   their root cause invisible in it — the map pointed, the code proved. And the consumer's
   `/rendelesek/erdeklodesek` turned out to read a different entity entirely, which only
   the source and a `count(*)` could say.

   ⚠ The danger is not that the map is wrong; it is that a map *looks like* an overview.
   A "I checked it" resting on the atlas is exactly as unverified as "the code looks fine".
   Say this in every prompt and doc; a reader who over-trusts it is the failure mode.
3. **Every cap and every omission is announced.** `actions_more`, `components_more`,
   failed screens in `INDEX.md`. A silently truncated list is the specific bug this tool
   exists to catch — shipping it would be self-refuting.

## Tests

```bash
node --test          # zero dependencies, 13 tests
```

**Every regression test comes from a bug that actually happened**, and the comment says
which one with its measurement. This is not decoration: three of the thirteen guard
against changes that *look* like improvements (more aggressive normalization, a tighter
cap, a broader import match). Do not add a test for a hypothetical.

When you fix something, the test comes first and it must fail before the fix.

## The consumer project — how to try changes for real

`consumer-a` (`~/code/consumer-a`) is the measurement environment: a 33-screen
Next.js ERP with a production-copy database.

```bash
cd ~/code/consumer-a
pnpm dev                                  # port 3100 — must be running
node ../set-atlas/src/cli.mjs             # regenerate docs/atlas/
node ../set-atlas/src/cli.mjs --check     # exit 1 if the UI moved
```

The login comes from the consumer project's own config (`login()` in `atlas.config.mjs`,
which reads `ATLAS_EMAIL` / `ATLAS_PASSWORD`) — set-atlas holds no credentials of its own.
For this measurement environment the account and its psql upsert are in that project's
`docs/manual/README.md`.

⚠ **The local database is a production copy.** Real partner names and amounts. That is
exactly why the anonymization rule in `compress.mjs` exists — never relax it, and never
paste raw atlas output into anything public without checking.

## Talking to the other agent

Two agents work on this in parallel, connected through the **`consumer-a-atlas`** room
(`mcp__agent-comm__*` tools):

| agent | project | owns |
|---|---|---|
| `set-atlas` | `~/code/set-atlas` | the tool itself |
| `consumer-a` | `~/code/consumer-a` | the `ajanlat-ugy-alapu-modell` change; consumes the atlas |

- `mcp__agent-comm__send` — append to your own file in the room. **Sender and timestamp
  are generated server-side — never write your own name or date into the text.**
- `mcp__agent-comm__inbox` — read what arrived.
- One file, one writer: never edit the other agent's file.

What belongs in the room: measurements, contract changes, blocking questions. What does
not: anything durable — that goes into `docs/allapot.md` or the repo. **The conversation
is not a source of truth; if it is not written down, it was not decided.**

## Boundaries

- **No npm publish** without the user asking. Same for `git push`.
- **No new dependencies** without a measured reason. The package currently has zero
  runtime dependencies and one optional peer (Playwright, supplied by the consumer).
- Do not pin a browser version on consumers — `chromium` is passed in by the caller.

## Session handoff

Before switching sessions or running low on budget: `/handoff` writes this thread's open work
and **measured** state to `.set/handoff/<ID>--<slug>.md` and prints the ID; the successor loads
it with `/handoff <ID>`. The skill comes from
[set-claude-handoff](https://github.com/tatargabor/set-claude-handoff) and is generic —
**everything specific to this repo lives in `.claude/handoff.profile.md`** (versioned; the
skill file is not edited here, it is overwritten by `npx github:tatargabor/set-claude-handoff init`).

Note what the profile says about the third probe: the generator can be green and committed while
the consumer's atlas is stale. A handoff that reports only `node --test` is the typical miss.

## Current state and open work

👉 **[`docs/allapot.md`](docs/allapot.md)** — read this first. It carries the measurements
(so you don't re-measure), the design decisions with their reasons, and the ranked open
list. Keep it current: when something lands or a decision is made, update that file, not
a new one beside it.
