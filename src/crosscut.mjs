// The cross-section — the two questions a per-screen map structurally cannot answer.
//
// "Is there already a button for this somewhere?" and "can this screen be reached
// from the obvious place?" do not point DOWN into one screen, they point ACROSS all
// of them. Reading 33 screen pages to notice a duplicate is exactly the work nobody
// does — which is how the feature this tool was built for shipped twice and
// unreachable.
//
// Generated from the same recording, no extra capture.

/** Controls that DO something. A heading or a plain textbox is not an action. */
const ACTION_KINDS = new Set(["button", "link", "menuitem", "tab"])

/**
 * The share of screens above which a control is app chrome, not a screen's own action.
 *
 * ⚠ Stated here and printed in the file, never applied silently. Measured on a
 * 33-screen app: the sidebar, header and user menu appear on every screen, and listed
 * inline they are most of the file — while "appears on 33 screens" reads exactly like
 * the duplication being hunted for.
 */
const CHROME_SHARE = 0.8

/**
 * A URL reduced to the route it belongs to.
 *
 * Hrefs carry live record ids. Compared raw, every parameterised screen looks
 * unreachable — the false alarm that would make the orphan list worthless. Returns
 * null for anything that leaves the app: an external link is not internal navigation.
 */
export function patternFor(href) {
  if (!href || /^(https?:|mailto:|tel:|#|javascript:)/i.test(href)) return null
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/"
  if (!path.startsWith("/")) return null
  return (
    path
      .split("/")
      .map(seg =>
        // A segment that is an id — uuid, number, or a long opaque token — is the
        // route's parameter. Anything else is part of the route itself.
        /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(seg) || /^\d+$/.test(seg) || /^[0-9a-z]{16,}$/i.test(seg) ? "[id]" : seg
      )
      .join("/") || "/"
  )
}

const label = s => (s.state ? `${s.pattern}?${s.state}` : s.pattern)

function actionIndex(screens) {
  const byName = new Map()
  for (const s of screens) {
    if (s.error) continue
    const seen = new Set()
    for (const c of s.controlList ?? []) {
      if (!ACTION_KINDS.has(c.kind) || seen.has(c.name)) continue
      seen.add(c.name)
      if (!byName.has(c.name)) byName.set(c.name, { name: c.name, kind: c.kind, screens: [], sources: new Set() })
      const a = byName.get(c.name)
      a.screens.push(label(s))
      a.sources.add(s.pointers?.source ?? label(s))
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Every named action, grouped by name — one row per action, not per occurrence. */
export function buildActions(screens) {
  const live = screens.filter(s => !s.error)
  const all = actionIndex(live)
  // Below a handful of screens "on most screens" means nothing — with two screens
  // an action shared by both is the duplication we are looking for, not chrome.
  const limit = live.length >= 5 ? Math.ceil(live.length * CHROME_SHARE) : Infinity
  const chrome = all.filter(a => a.screens.length >= limit)
  // A list route and its detail route usually render ONE component — the id only
  // preselects a row — so "offered on two screens" says nothing about duplication.
  // Measured: 33 of 49 multi-screen rows were this, burying the few that were real.
  // The frontmatter already knows, so no heuristic is needed.
  const oneComponent = all.filter(a => a.screens.length > 1 && a.screens.length < limit && a.sources.size === 1)
  const own = all.filter(a => a.screens.length < limit && !oneComponent.includes(a))

  const row = a => `| \`${a.name}\` | ${a.screens.join(" · ")} |`
  return [
    "---",
    "generator: set-atlas",
    `actions: ${all.length}`,
    `screens: ${live.length}`,
    "---",
    "",
    "# Actions",
    "",
    "> GENERATED — do not edit. Every named action on every screen, one row each.",
    "",
    "Two screens on one row means the same label is offered in two places. That may be",
    "correct (one action, two entry points) or the duplication you are looking for — the",
    "map points, it does not prove. Similar names are NOT merged: `New quote` and",
    "`Generate new quote` stay apart, because deciding they are the same is a judgement.",
    "",
    "| action | screens |",
    "|---|---|",
    ...own.map(row),
    "",
    "## One component, several routes",
    "",
    "Every screen on these rows is rendered by the SAME source file, so the action is",
    "offered once and reached by more than one URL — a list and its detail view, say.",
    "Kept separate from the list above because there it would read as duplication.",
    "",
    "| action | screens | source |",
    "|---|---|---|",
    ...oneComponent.map(a => `| \`${a.name}\` | ${a.screens.join(" · ")} | \`${[...a.sources][0]}\` |`),
    "",
    `## Everywhere — on ${limit} of ${live.length} screens or more`,
    "",
    `Present on at least ${Math.round(CHROME_SHARE * 100)}% of screens, so this is the app's`,
    "chrome — a sidebar, a header, a user menu — not any one screen's own action. Listed",
    "separately rather than dropped: the threshold is a rule of thumb, and a real duplicate",
    "could hide behind it.",
    "",
    "| action | screens |",
    "|---|---|",
    ...chrome.map(a => `| \`${a.name}\` | ${a.screens.length} |`),
    "",
  ].join("\n")
}

/** Which screen reaches which — and which screen nothing reaches. */
export function buildNavigation(screens) {
  const live = screens.filter(s => !s.error)
  const known = new Map(live.map(s => [s.pattern, s]))
  const edges = []
  const reached = new Set()

  for (const s of live) {
    const out = new Map()
    for (const c of s.controlList ?? []) {
      if (c.kind !== "link") continue
      const target = patternFor(c.href)
      if (!target || target === s.pattern) continue
      if (!out.has(target)) out.set(target, c.name)
      if (known.has(target)) reached.add(target)
    }
    for (const [target, name] of out) edges.push({ from: label(s), target, name, known: known.has(target) })
  }

  // A screen no recorded link points at. ⚠ This is evidence, not proof: it may be
  // reached by a redirect, a router push in code, or a link that only appears after
  // interaction — none of which a navigation-only recording can see.
  const orphans = live.filter(s => !reached.has(s.pattern))
  const outside = [...new Set(edges.filter(e => !e.known).map(e => e.target))].sort()

  return [
    "---",
    "generator: set-atlas",
    `links: ${edges.length}`,
    `orphans: ${orphans.length}`,
    "---",
    "",
    "# Navigation",
    "",
    "> GENERATED — do not edit. Built from the links present at recording time.",
    "",
    "| from | link | to |",
    "|---|---|---|",
    ...edges
      .sort((a, b) => a.from.localeCompare(b.from) || a.target.localeCompare(b.target))
      .map(e => `| ${e.from} | \`${e.name}\` | ${e.target}${e.known ? "" : " *(not in the atlas)*"} |`),
    "",
    "## Nothing links here",
    "",
    "No recorded link points at these screens. ⚠ That is a lead, not a verdict: a screen",
    "can still be reached by a redirect, by navigation in code, or by a link that only",
    "appears after interaction — and this recording only visited each URL directly.",
    "",
    ...(orphans.length ? orphans.map(s => `- ${label(s)}${s.title ? ` — ${s.title}` : ""}`) : ["*(none)*"]),
    "",
    ...(outside.length
      ? [
          "## Links leaving the atlas",
          "",
          "Reached from a recorded screen, but not recorded themselves — either missing from",
          "the config, or genuinely outside the app.",
          "",
          ...outside.map(t => `- ${t}`),
          "",
        ]
      : []),
  ].join("\n")
}
