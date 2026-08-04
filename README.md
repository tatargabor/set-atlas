# set-atlas

**A generated, compact map of your running app's UI — for the agent that has to design on it.**

Spec-driven development got good at describing *what* to build. It stayed bad at *where it goes*.
An agent planning a new feature knows your domain, your schema and your requirements — and has
no idea that the screen it's about to extend already has that button, two tabs over.

set-atlas records the running app and writes one small markdown page per screen: the menus, the
buttons, the tabs, the filters, the table columns, and where every link leads. Plus, on each page,
**where to look for more** — the source file, the components, the reachable server actions.

```
33 screens · ~23.8k tokens (raw ~143.8k — 83% smaller)
```

That's the whole surface of a mid-size ERP. At design time you need three or four screens of it —
about 2k tokens, small enough to sit next to a proposal.

## Why regions, and not just the accessibility tree

Control names and roles come from the layer screen readers and browsing agents already consume, so
they are stable against CSS churn and honest about what is reachable. But the accessibility tree has
**no role for a column** — and rightly so: a column means nothing to a screen reader. It means
everything to whoever is deciding where a new button goes.

So the layout is recovered from the rendered boxes and printed as a region tree.

Measured blind on six layout archetypes — six formats, 46 questions with answers computed from
geometry rather than judged (the full study lives with the app it was measured on, not in this package):

| format | correct | tokens |
|---|---|---|
| **region tree (what this ships)** | **44/46** | **4,480** |
| a screenshot of the same screen | 43/46 | ~9,600 image tokens |
| flat accessibility dump (what this used to ship) | 40/46 | 9,081 |

Two results shaped the format:

- **Coordinates are noise.** An arm that printed `[x,y w×h]` on every element scored *worse*
  (42/46) and cost 51% more. Containment and size are the signal.
- **Scroll depth is the fact nothing else carries.** One screen held 18,866px of list in a 318px
  frame; the accessibility tree cannot say it and the screenshot cannot show it.

If a page won't give up its geometry, the map falls back to the flat accessibility dump and says so
in `map_kind:` — a worse map beats a missing one, as long as nobody has to guess which they got.

## Why generated, not hand-written

A hand-maintained UI description is wrong within two weeks, and a *stale* map is worse than none:
planning quietly builds on it. So nothing here is hand-maintained. Re-run the command, diff the
result — if the pages changed, the surface changed.

```bash
npx set-atlas            # regenerate
npx set-atlas --check    # exit 1 if the atlas is stale (git hook / CI)
```

### When a screen can't be recorded

Some screens fail — a page that never settles, a route that started 404ing. That screen's page
from the last good run **stays**, because a deleted page and a screen that never existed look
identical from outside. What changes is that the page stops claiming to be current:

```yaml
stale_since: 2026-08-04T13:08:00.414Z
stale_reason: ariaSnapshot did not settle after a retry
```

followed by a `> ⚠ **STALE**` note above the map. The run prints `✗`, `INDEX.md` lists the screen
under *Could not be recorded*, and now the file itself says so too — the reader who opens one page
is the one who would otherwise never find out.

`--check` fires **once**, when a page goes stale or its reason changes. `stale_since` moves on
every run while the screen stays broken, so it is excluded from the comparison for the same reason
`generated_at` is: a gate that always fires is a gate nobody keeps.

## What a page looks like

```yaml
---
route: /orders/[id]
title: Order detail
source: src/app/orders/[id]/page.tsx
components:
  - src/components/email-send-dialog.tsx
  - src/components/order/clarification-modal.tsx
actions:
  - actions.ts::getOrderDetail
  - actions.ts::addOrderItem
manual: docs/manual/chapters/02-orders.md
map_kind: regions
regions: 12
tokens: 604
---
```

````
- panel [1600×1000 row]
  - navigation [63×895 column]
    - link "Dashboard"
    - link "Orders"
    - link "Products"
  - panel [1536×1000 column]
    - toolbar strip [1536×56 row]
      - searchbox "Search"
      - button "New quote" [right]
    - panel [1536×944 row]
      - scrollable list "Incoming orders" [319×761] — ⇅ 24914px of content in a 761px frame
        - repeated item ×257 [319×88]
      - tab bar + panel [725×998 column]
        - tab "Details" [selected]
        - tab "Items"
        - button "Approve" [right]
````

Three panes side by side, the sizes that say which is the list and which is the detail, a list 33
screens deep behind a 761px window, and which end of a bar each action sits on. A flat tree can
express none of it; a screenshot shows neither the scroll depth nor the exact count.

`[right]` / `[centre]` mark position **within** a region — left is the default and carries no
marker, so a plain column costs nothing. Adding this layer measured 48/49 against 46/49 without it,
for 13% more tokens: the gain landed on exactly the question every format had been failing
(*"which quadrant is this search box in?"* — it is at the right end of a full-width bar, and
reading order never said so).

## What gets thrown away — and why

| dropped | reason |
|---|---|
| table rows, list records | row 200 says nothing about the screen; the **column structure** is kept |
| data-shaped names (`"Jane Doe … INV-00303 … 312.459 Ft"`) | real data leaks into docs, and every new record would rewrite the file |
| free text, images | content, not interface |
| repeated siblings | collapsed to `(× 47)` — **but only when the name is identical too** |

That last rule is load-bearing. An early version normalized names away before collapsing, and
eleven distinct menu items became one `link "…"  (× 11)` — the navigation disappeared from the map
built to show navigation. There's a regression test for it.

## Install

```bash
pnpm add -D set-atlas
cp node_modules/set-atlas/atlas.config.example.mjs atlas.config.mjs
```

Playwright is a peer dependency — set-atlas uses the one your project already has, and never pins
a browser version on you. Point the config at a running dev server (a seeded database gives the
most useful map) and run `npx set-atlas`.

## Configuration

See [`atlas.config.example.mjs`](./atlas.config.example.mjs). The essentials:

- **`routes`** — `url` is what the browser visits, `pattern` is the route shape (`/orders/[id]`)
  that drives the filename and source lookup, so the map stays stable across records.
- **`actions`** — setup steps for screens that only exist after interaction (dialogs, tabs).
- **`login`** — called once; programmatic login is recommended, UI login is flaky in dev mode.
- **`pointers()`** — your project's own links (manual chapter, screenshot, spec). `source`,
  `components` and `actions` are generated for you.

## Status

Early. Working and measured on one real Next.js ERP (33 screens). Known gaps:

- **Dense forms compress poorly** — on a screen where everything is interactive there is little to
  drop (measured: 5% on one editor, against 83% overall).
- **Public/unauthenticated screens** need a separate pass; a logged-in session redirects away.
- **Non-Next.js source resolution** currently needs a `pointers()` hook.

## License

MIT
