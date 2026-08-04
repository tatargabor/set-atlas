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
npx set-atlas context --change <change-name>
```

---

```markdown
## Surface fit

> Answered from `docs/atlas/`. The atlas **guides, it does not prove**: it cannot see
> server-side scope, so every claim below that matters is confirmed in the code.

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
npx set-atlas --diff    # the lines this change moved on the surface
```
<!-- Paste the lines the change was supposed to produce. If the diff is empty
     where you promised a control, the change did not land. -->
```

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
