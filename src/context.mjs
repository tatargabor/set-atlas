// Which screens does THIS change touch — and which ones does it suspiciously not?
//
// The whole atlas is ~28k tokens. Nobody pastes that into a planning context, and
// an agent that gets it reads the first screen and skims the rest. This picks the
// few pages a specific change actually concerns, says why each was picked, and
// says out loud what it left out.
//
// ⚠ The selection is a POINTER, not a proof. It matches on routes and file paths
// the change already names, so it can only find screens the change is aware of —
// which is exactly the blind spot that produced this package. That is why the
// neighbourhood and the cross-section questions are printed with it: the screen
// that matters most is often the one the change never mentions. Measured
// 2026-08-04: a critical finding sat on a screen absent from the change's own
// impact list, and no amount of reading that list would have surfaced it.

import fs from "node:fs"
import path from "node:path"

const CROSS_SECTION = ["INDEX.md", "ACTIONS.md", "NAVIGATION.md"]

/** Frontmatter as a flat map; list values become arrays. */
export function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return {}
  const end = text.indexOf("\n---\n", 4)
  if (end < 0) return {}
  const fields = {}
  let listKey = null
  for (const line of text.slice(4, end).split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && listKey) {
      fields[listKey].push(item[1].trim())
      continue
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (!kv) continue
    if (kv[2] === "") {
      listKey = kv[1]
      fields[listKey] = []
    } else {
      listKey = null
      fields[kv[1]] = kv[2].trim()
    }
  }
  return fields
}

/** Every screen page in the atlas, with the strings a change could name it by. */
export function readAtlas(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !CROSS_SECTION.includes(f))
    .map((file) => {
      const text = fs.readFileSync(path.join(dir, file), "utf8")
      const front = parseFrontmatter(text)
      const paths = ["source", "manual", "kezikonyv"]
        .flatMap((k) => front[k] ?? [])
        .concat(front.components ?? [], front.actions ?? [])
        .filter(Boolean)
      return { file, text, route: front.route, title: front.title, url: front.url, paths, stale: front.stale_reason }
    })
    .filter((p) => p.route)
}

/** Every .md under the change directory, concatenated — proposal, design, tasks, spec deltas. */
export function readChange(dir) {
  const out = []
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".md")) out.push(fs.readFileSync(full, "utf8"))
    }
  }
  walk(dir)
  return out.join("\n")
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * A route is named only when it stands on its own. Plain `includes` made
 * `/rendelesek` match every mention of `/rendelesek/[id]`, so the list screen was
 * pulled in by any change that only touched the detail screen — and with the cap
 * at five, one such false hit pushes out a real one.
 *
 * ⚠ The trailing `/` has to be excluded too, and that is the whole bug: a
 * lookahead of `[\w-]` alone still let `/rendelesek` match inside
 * `/rendelesek/[id]`, because the next character there is a slash.
 */
const namesRoute = (text, route) => new RegExp(`(?<![\\w/-])${escape(route)}(?![\\w/-])`).test(text)

/** Scored, most-specific first. `why` is printed beside every pick — a selection nobody can check is a selection nobody trusts. */
export function selectPages(pages, changeText) {
  return pages
    .map((page) => {
      const why = []
      if (namesRoute(changeText, page.route)) why.push(`the change names the route \`${page.route}\``)
      if (page.url && namesRoute(changeText, page.url)) why.push(`the change names the URL \`${page.url}\``)
      for (const p of page.paths) if (changeText.includes(p)) why.push(`it references \`${p}\``)
      return { ...page, why, score: why.length }
    })
    .filter((p) => p.score)
    .sort((a, b) => b.score - a.score || b.route.length - a.route.length)
}

/** `| from | `label` | to |` rows, as edges. */
export function readNavigation(dir) {
  const file = path.join(dir, "NAVIGATION.md")
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.match(/^\|\s*(\S+)\s*\|\s*`(.*)`\s*\|\s*(\S+)\s*\|$/))
    .filter(Boolean)
    .map((m) => ({ from: m[1], label: m[2], to: m[3] }))
}

/**
 * A link that appears on almost every screen is furniture, not a relationship.
 *
 * ⚠ Measured on the consumer 2026-08-04: with the app's sidebar counted, "one link
 * away from /ajanlatok/[id]" listed 25 screens, 24 of them because every page in
 * the app has a `Rendelések` link in its global nav. A neighbourhood that
 * contains everything says nothing — and the list it buried is the one thing this
 * section exists to show.
 */
const CHROME_RATIO = 0.6

export function chromeLinks(edges, screenCount) {
  const sources = new Map()
  for (const e of edges) {
    const key = `${e.label}→${e.to}`
    if (!sources.has(key)) sources.set(key, new Set())
    sources.get(key).add(e.from)
  }
  return new Set([...sources].filter(([, from]) => from.size > CHROME_RATIO * screenCount).map(([key]) => key))
}

/**
 * Screens one link away from the picked ones. This is where the failure this
 * package was extracted from actually lives: the feature was built, but it was
 * built on a screen nothing reached, and the obvious entry point never got it.
 */
export function neighbours(edges, chosen, screenCount = 0) {
  const chrome = chromeLinks(edges, screenCount)
  const picked = new Set(chosen.map((p) => p.route))
  const out = new Map()
  let hidden = 0
  for (const e of edges) {
    const touches = (picked.has(e.from) && !picked.has(e.to)) || (picked.has(e.to) && !picked.has(e.from))
    if (!touches) continue
    if (chrome.has(`${e.label}→${e.to}`)) {
      hidden++
      continue
    }
    if (picked.has(e.from)) out.set(e.to, `the \`${e.label}\` link on \`${e.from}\` points here`)
    else out.set(e.from, `reaches the picked screen via its \`${e.label}\` link`)
  }
  return { near: [...out].map(([route, why]) => ({ route, why })), hidden }
}

export function buildContext({ atlasDir, changeDir, changeName, top = 5 }) {
  const pages = readAtlas(atlasDir)
  const changeText = readChange(changeDir)
  const ranked = selectPages(pages, changeText)
  const chosen = ranked.slice(0, top)
  const { near, hidden } = neighbours(readNavigation(atlasDir), chosen, pages.length)

  const out = [
    `# Surface context — \`${changeName}\``,
    "",
    "> GENERATED. The atlas **guides, it does not prove**: it cannot see server-side scope",
    "> (`where` clauses, query filters), so anything you find here has to be confirmed in the code.",
    "",
  ]

  if (!chosen.length) {
    // Not an error, and not silence either: a change that names no screen is a
    // finding on its own — either it touches no UI, or nobody wrote down where it lands.
    out.push(
      `⚠ **This change names no screen in the atlas** (${pages.length} pages checked).`,
      "",
      "Either it touches no UI, or **nobody wrote down where it lands** — and the second is the",
      "failure this tool exists to catch. Open `INDEX.md` and decide which one it is.",
      ""
    )
    return out.join("\n")
  }

  out.push(
    `**${chosen.length} of ${pages.length} screens**, picked because the change text names them.` +
      (ranked.length > chosen.length ? ` ⚠ ${ranked.length - chosen.length} further page(s) also matched but were cut by \`--top ${top}\`: ${ranked.slice(top).map((p) => `\`${p.route}\``).join(", ")}.` : ""),
    ""
  )

  for (const page of chosen) {
    out.push(`## \`${page.route}\` — ${page.title ?? ""}`, "", `_Picked because: ${page.why.join(" · ")}._`, "")
    if (page.stale) out.push(`⚠ **This page is STALE** — the recording failed: ${page.stale}. What follows is an earlier state of the screen.`, "")
    out.push(page.text.replace(/^---\n[\s\S]*?\n---\n/, "").trim(), "")
  }

  if (near.length) {
    out.push(
      "## The neighbourhood — what the change does NOT mention",
      "",
      "One link away from the screens above. This is where the measured failure lived: the",
      "feature was built, but on a screen nothing reached, and the obvious entry point never got it.",
      "",
      ...near.map((n) => `- \`${n.route}\` — ${n.why}`),
      "",
      // Announced, not silently dropped: the reader has to know the list is a
      // filtered one, or a missing screen reads as "nothing links there".
      ...(hidden ? [`⚠ ${hidden} link(s) left out as global navigation (present on over 60% of screens) — furniture, not a relationship.`, ""] : [])
    )
  }

  out.push(
    "## Answer these before you write the plan",
    "",
    "1. **Which screen does it land on**, and which region of it? Name them from the maps above.",
    "2. **Which entry point reaches it?** If none of the screens above does, the feature is orphaned.",
    "3. **Is a similarly named action already offered?** Check `ACTIONS.md` — one label on two",
    "   screens is either one action with two entry points, or the duplication you are looking for.",
    "4. **Which screen gets nothing, and should have?** Read the neighbourhood list for that one.",
    ""
  )
  return out.join("\n")
}
