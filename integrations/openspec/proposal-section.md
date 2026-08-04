# The `## Surface fit` section

Copy this into your change proposal template, next to `## Why` and `## What changes`.

**Why it is mandatory rather than optional.** Measured on the project this package was
extracted from (2026-08-04): a critical finding sat on a screen that the change's own impact
list never mentioned, so no amount of reading that list would have surfaced it. A section that
asks about the screens a change does *not* touch is the only part of a proposal that can catch
it. The quote feature that started all of this shipped redundantly and unreachable from the
obvious place, and nobody noticed until a human clicked through the UI.

Generate the context first — it answers most of this for you:

```bash
node <path-to>/set-atlas/src/cli.mjs context --change <change-name>
```

---

```markdown
## Surface fit

> Answered from `docs/atlas/`. **The atlas does not replace reading the code.** It is a
> snapshot of the rendered DOM — it cannot see server-side scope, state, or call chains.
> It gave the questions below; the source gave the answers.

**Lands on:** `<route>` → `<region name from the map>`

**Reached from:** `<screen>` → `<the control that gets the user there>`
<!-- If nothing reaches it, say so here. That is the finding, not an omission. -->

**Already offered elsewhere?** `<action label>` — checked in `ACTIONS.md`:
<!-- One label on two screens is either one action with two entry points, or the
     duplication this section exists to catch. Say which, and why. -->

**Screens deliberately NOT touched:**
<!-- From the neighbourhood list. For each, one line on why it is correct that it
     gets nothing. "Not in scope" is not a reason; "the user never arrives from
     there" is. -->

**Verified after the change:**
```bash
node <path-to>/set-atlas/src/cli.mjs --diff   # the lines this change moved on the surface
```
<!-- Paste the lines the change was supposed to produce. If the diff is empty
     where you promised a control, the change did not land. -->
```

### When the change has no surface

```markdown
## Surface fit

[SURFACE: NONE] — <why. Not "out of scope": name what this touches instead, and how you
established that no screen changes. A queue worker, a migration, a scheduled job.>
```

⚠ **This branch is not an escape hatch — it is the defence against a fabricated section.**
Reported by a consumer that shipped this as a gate, 2026-08-04: without an explicit "no
surface" verdict, the author of a backend change *invents screens* to get past the check,
and an invented section is **worse than a missing one**, because it looks like the work was
done. Same failure as the wrong `source:` pointer this tool had: well-formed, and wrong in
the reassuring direction.

## If you gate this — what a gate has to catch

A check for *"is there a `## Surface fit` heading?"* passes all four of these, and the
consumer measured all four in practice:

| hollow form | why it passes a naive check |
|---|---|
| the heading and nothing under it | the heading is present |
| prose that names no route | there is text |
| a route, but no verdict on the screens NOT touched | this is the common one — the impact list, reworded |
| `[SURFACE: NONE]` with no reason | the tag is present |

Two things their measurement paid for, worth copying:

- **Extract the section WITHOUT its heading line.** Otherwise the section's own title is the
  evidence that it has content, and the empty case passes. One line of difference.
- **Judge the reason by LENGTH, not by keywords.** They first looked for a long run of
  letters and it rejected every valid reason written in a natural language — the working
  measure is the length of what remains once the verdict tag is removed.

Start it as a **warning with a baseline**, not a block. A gate introduced as blocking on an
existing tree gets its first `SKIP=1` immediately, and a skipped gate is a dead one.

---

## What each question is for

| question | the failure it catches |
|---|---|
| Lands on | a feature with no home — built, but on no particular screen |
| Reached from | the orphan: it exists, nothing links to it |
| Already offered | the duplicate: the second implementation of an action that was already there |
| NOT touched | the wrong-place failure: it landed somewhere, just not where the user looks |
| Verified after | the promise nobody checked — the plan said a control appears, and it did not |

The last one is the only one a machine can check on its own, which is why `--diff` exists.
The other four are judgement, and the atlas is there so the judgement has something to stand on.
