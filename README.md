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

## Why the accessibility tree

The map comes from Playwright's `page.ariaSnapshot()` — the accessibility tree as YAML. It is the
same layer screen readers and browsing agents already consume, which makes it:

- **stable** — it survives CSS churn; it changes when the *meaning* of the UI changes,
- **honest** — if a control isn't in the tree, agents can't see it either,
- **cheap** — text, not pixels.

## Why generated, not hand-written

A hand-maintained UI description is wrong within two weeks, and a *stale* map is worse than none:
planning quietly builds on it. So nothing here is hand-maintained. Re-run the command, diff the
result — if the pages changed, the surface changed.

```bash
npx set-atlas            # regenerate
npx set-atlas --check    # exit 1 if the atlas is stale (git hook / CI)
```

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
tokens: 791
---
```

````
- main:
  - heading "Orders" [level=1]
  - tablist:
    - tab "Details" [selected]
    - tab "Items"
  - button "New quote"
  - searchbox "Search"
  - table:
    - columns: Date · Amount · Partner · Status
- navigation "Main navigation":
  - link "Dashboard":
  - link "Orders":
  - link "Products":
````

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
