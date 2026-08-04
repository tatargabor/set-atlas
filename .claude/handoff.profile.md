# Handoff profile — set-atlas

> Read by the `/handoff` skill (`set-claude-handoff`). **Project-owned**: `init` creates it once
> and never overwrites it, so a skill upgrade cannot clobber these probes.
>
> Upgrade the skill with: `npx github:tatargabor/set-claude-handoff init`

## What "state" means here

This is a **generator**: it drives a running app with Playwright and writes a compact UI map.
"Where do I stand" therefore has three independent parts, and they drift apart:

1. **The code** — is `node --test` green, is the working tree committed;
2. **The output** — does the atlas the consumer project holds still match the current generator,
   i.e. would `--check` pass, and when was `docs/atlas/` last regenerated;
3. **The research harness** — whether a measurement run is half-finished under `research/`.

A handoff that only reports (1) is the typical failure here: the generator can be green and
committed while the consumer's atlas is stale, and nothing says so.

## Probes

| command | what it tells you | expect |
|---|---|---|
| `node --test` | is the suite green | all pass, 0 fail |
| `git status --short` | uncommitted **and** untracked work | usually only `research/` noise |
| `git log --oneline -8` | where the tree is | — |
| `cd ~/code/consumer-a && node ../set-atlas/src/cli.mjs --check` | has the consumer's UI moved away from the committed atlas | exit 0 = in sync; exit 1 = regeneration owed |
| `git -C ~/code/consumer-a status --short -- docs/atlas/` | is a regenerated atlas sitting uncommitted in the consumer | — |
| `ls -lt research/runs 2>/dev/null \| head` | when a measurement last ran | — |

⚠ **The `--check` probe needs the consumer app running** (`pnpm dev` on port 3100) and the
screenshot user from its `docs/manual/README.md`. If it is not running, write *"not measured —
consumer app down"*, never an assumption.

## Never lose

- `.set/` — session scratch (dictation capture, copilot state). Gitignored, so after a `/clear`
  nobody can discover it existed. If a recording is not yet handed over, list it in §1 by name.
- `research/corpus/ · runs/ · variants/ · prompts/ · answers/ · *.json` — gitignored **because
  they are generated from a production-copy database** (real names, addresses, amounts). Losing
  them costs a rerun; **committing or pasting them costs a leak.** Reference them by path in a
  handoff — never quote their content.
- Untracked drafts under `docs/`.

## Parallel sessions

`consumer-a` (`~/code/consumer-a`) is the measurement environment and has its own sessions
running against the same machine. Its files are **not** ours: only `docs/atlas/` is written from
here, and only by a regeneration run. If a consumer-a session is active, say so in §6.

## Template extras

- In §4, when reporting a measurement, give the **run directory** rather than pasted numbers if
  the numbers came from production-copy data.
- The atlas **guides, it does not prove** (CLAUDE.md, principle 2). If the handoff carries a
  finding that came out of atlas output, mark whether it was verified against the code — a
  successor cannot tell the two apart afterwards.
