---
name: surface-fit
description: Where does this change land in the running UI? Use when planning, reviewing or writing a change proposal that touches the interface — before deciding which screen a feature goes on, whether an action already exists somewhere, or whether anything reaches the new screen. Also use when a proposal's "Surface fit" section has to be filled in or checked.
---

# surface-fit — plan on the UI that exists, not the one you remember

Copy this file to `.claude/skills/surface-fit/SKILL.md` in the consuming project.

**The failure it prevents**, measured on the project this came from: a quote feature shipped
redundantly and unreachable from the obvious place, and nobody noticed until a human clicked
through the UI. Spec-driven development had become good at describing *what* to build and stayed
blind to *where it goes*.

## Use it in this order

**1. Get the screens this change concerns — not the whole atlas.**

```bash
node <path-to>/set-atlas/src/cli.mjs context --change <change-name>
```

⚠ **Not `npx set-atlas`.** The package is unclaimed on npm (checked 2026-08-04), so `npx`
resolves to nothing today — and to whoever claims the name tomorrow. Invoke it by path, or
link it into the project.

~5k tokens instead of ~39k, and it says why each screen was picked and what it left out. It
drives no browser, so it works whether or not the app is running.

**2. Answer the four questions it prints.** They are not rhetorical. The one that catches the
most is the last: *which screen gets nothing, and should have?* Read the neighbourhood list for
it — the screen that matters is usually the one the change never mentions.

**3. Check the cross-section before adding an action.** `docs/atlas/ACTIONS.md` lists every named
action and the screens offering it. One label on two screens is either one action with two entry
points, or the duplication you are about to make a third of. `docs/atlas/NAVIGATION.md` lists
what reaches what, and what nothing reaches.

**4. After building, check that the change actually landed.**

```bash
node <path-to>/set-atlas/src/cli.mjs --diff
```

The lines that moved on the surface. If the diff is empty where the plan promised a control, the
change did not land — this is the only step here a machine can check on its own.

## The rule that keeps this honest

**The atlas does not replace reading the code.** It helps you understand, plan and orient — it
does not verify. It is generated from the rendered UI, so it cannot see
server-side scope — `where` clauses, query filters, permission checks. Measured 2026-08-04: of
ten findings a review agent produced from the atlas, two had their root cause invisible in it.
The map pointed; the code proved. Every finding you take from the atlas gets confirmed in the
source before it goes in a proposal.

Two more things it does not carry, both stated on the pages themselves:

- a map recorded by navigation alone holds **no interaction-dependent region** — no detail pane,
  no action bar, no search result. The page says `⚠ capture: navigation only` when that is the case.
- a page marked `stale_since:` is from an **earlier recording** — its screen failed to record on
  the last run. Do not read it as current.

## If the atlas looks out of date

```bash
node <path-to>/set-atlas/src/cli.mjs --check   # exit 1 if the UI moved away from the committed atlas
node <path-to>/set-atlas/src/cli.mjs           # regenerate (needs the app running)
```

Never edit `docs/atlas/` by hand. A hand-maintained UI description is wrong within two weeks, and
a stale map is worse than none because planning quietly builds on it.
