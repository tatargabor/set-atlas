# Wiring the atlas into every phase, not just the proposal

Copy the blocks below into the corresponding skills of your spec workflow.

**The gap this closes**, measured on the consuming project 2026-08-05: the atlas had a
`## Surface fit` section in the proposal template and a standalone `surface-fit` skill — and
of the five skills that run the *rest* of the cycle (`apply`, `continue`, `verify`, `archive`,
`explore`), **not one mentioned the atlas**. So the integration fired only when somebody
happened to remember it. A tool that has to be remembered is a tool that gets used on the days
it is least needed.

Each block below is small on purpose. A phase skill that grows a page of atlas instructions
gets skimmed; three lines with one command get run.

---

## `explore` / `new-change` — before deciding where a feature goes

```markdown
### The surface this touches

    node <path-to>/set-atlas/src/cli.mjs context --change <name>     # a change directory exists
    node <path-to>/set-atlas/src/cli.mjs context --files <paths…>    # it does not yet

~5k tokens instead of the whole atlas, and it says why each screen was picked. Drives no
browser: this works whether or not the app is running.

Answer the four questions it prints — especially the last, *which screen gets nothing and
should have?* The screen that matters is usually the one the change never mentions.
```

---

## `apply` — while the work is happening

```markdown
### Which screens am I moving?

    node <path-to>/set-atlas/src/cli.mjs context --files $(git diff --name-only)

Run it when the set of touched files stops growing. It answers the question a task list cannot:
the fix you are writing belongs to a *class* of screens, and the report that started it named
one. Measured on this project: a single client component turned out to draw three routes.

⚠ Do not regenerate the atlas mid-change. It records the UI as it is at that instant; a
half-applied change recorded as fact is worse than a day-old map.
```

---

## `continue` — picking the work back up

```markdown
### What has already landed on the surface

    node <path-to>/set-atlas/src/cli.mjs suspect      # no app needed, safe to run anywhere

It reads the commit the atlas was recorded from, and names the screens whose files have moved
since. That is the shortest honest answer to "where was I" — shorter than re-reading tasks.md,
and it cannot be out of date with the tree the way a task list can.
```

---

## `verify` — the only step a machine can check on its own

```markdown
### Did the change reach the UI it promised?

    node <path-to>/set-atlas/src/cli.mjs --diff       # needs the app running

Compare the output against the `## Surface fit` section of the proposal:

- the section promised a control, and the diff shows it   → landed
- the section promised a control, and the diff is silent   → **it did not land**, whatever the
  tests say. Tests measure behaviour, the spec states intent, and this is the one gap nothing
  else covers.
- the diff shows a screen the section never mentioned      → also a finding. Something moved
  that nobody planned to move.

⚠ Read the lines, not the exit code. The exit code says "something changed", which is true of
almost every run and tells you nothing.
```

---

## `archive` — the last chance to keep the map true

```markdown
### The atlas must not be left behind

    node <path-to>/set-atlas/src/cli.mjs suspect --strict     # exits 1 if UI files moved past the atlas

If it fires, regenerate before archiving (needs the app running):

    node <path-to>/set-atlas/src/cli.mjs

A stale UI description is worse than none, because the next change plans on top of it silently.
Archiving is the moment the change stops being watched, so it is the last moment this is cheap.
```

---

## The pre-commit / pre-push hook

The real staleness check (`--check`, `--diff`) needs a running app, a database and a login.
Hooks deliberately run with none of those, so putting it there gets you one of two failures: a
hook that falls over, or — worse — one that passes quietly because it could not do its job.

`suspect` is the version that fits: repository only.

```bash
#!/bin/sh
# .git/hooks/pre-push — warn when the atlas is behind the UI files.
# Warning, not a block: without the app this cannot tell whether the SURFACE moved,
# only that a file which draws one did. Overstating that is how a gate loses trust.
node ../set-atlas/src/cli.mjs suspect || true
```

Add `--strict` once the repo is caught up and you want it to stay that way. Not before: a gate
introduced as blocking on a tree that already fails it earns its first `SKIP=1` the same week,
and a skipped gate is a dead one.

### What it prints

```
⚠ SUSPECT — 15 file(s) that draw a screen have moved since the atlas was recorded (`758f4997`).

    src/app/ajanlatok/[id]/quote-editor-client.tsx
    src/app/rendelesek/rendelesek-client.tsx
    …

  Screens these files draw — check these, not all of them:
    /ajanlatok/[id]              →  ajanlatok-id.md
    /rendelesek/[id]             →  rendelesek-id.md
    …
```

Naming the screens is the whole point. *"15 UI files changed"* sends the author to look at all
33 screens, which means looking at none; *"these six screens"* is a warning that gets acted on.

### What it deliberately does not claim

- **A `.ts` file moving is not suspicious.** The test is the extension: a server action or a lib
  module changes no pixel. Measured on the consumer: a directory-based rule dropped 130 files,
  121 of them `.ts` — and it also dropped the route-local client components, which is where most
  of that app's UI lives.
- **An atlas with no `generated_from_commit` counts as suspect**, not as clean. A gate that
  answers "fine" when its evidence is missing reports a check that never ran.
- **A UI file that maps to no screen is said out loud**, not swallowed. It means either a screen
  the atlas has never recorded, or pointers that do not reach it. Both are worth knowing.
