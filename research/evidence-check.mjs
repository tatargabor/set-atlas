// Usefulness benchmark, first layer — does the atlas CARRY the evidence?
//
// The format benchmark asks whether a reader can find things on the map. This
// one asks a question that comes from outside the tool entirely: people filed
// bugs about the running UI, and for each one it checks whether the screen it
// concerns is in the atlas and whether the elements the report names appear on
// that page.
//
// Why this and not "would an agent have found it": that measurement needs blind
// runs in isolated contexts and a pre-registered list, and it is expensive and
// noisy. This is the NECESSARY condition underneath it, and it is free:
//
//   evidence absent  → the atlas could not possibly have helped. A blind spot,
//                      and the tool should say so out loud.
//   evidence present → an attentive reader COULD have seen it. It does not
//                      follow that one would. ⚠ Do not report this as a hit.
//
// The input is the consumer's own bug files; nothing about them is invented here.
// Assumed format: markdown with YAML frontmatter carrying `id`, `type`, `title`
// and `pageUrl`, and a body that names UI elements in `backticks` or "quotes".
//
//   ATLAS_CONSUMER=/path/to/app ATLAS_BUGS=openspec/bugs/internal \
//     node research/evidence-check.mjs SET-0156 SET-0157 …

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const CONSUMER = process.env.ATLAS_CONSUMER
if (!CONSUMER) throw new Error("Set ATLAS_CONSUMER to the consumer app's root.")
const BUGS = path.join(CONSUMER, process.env.ATLAS_BUGS ?? "openspec/bugs/internal")
const ATLAS_DIR = process.env.ATLAS_DIR ?? "docs/atlas"
const ATLAS = path.join(CONSUMER, ATLAS_DIR)
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"))

// ⚠ The measurement is only valid if the atlas and the report describe the SAME
// instant. Measured 2026-08-05: run against the working tree, six of seven
// reports showed "no anchor carried" — but by then the consumer had FIXED the
// screens, so `quote-preview-panel` was absent because it no longer existed.
// The tool would have scored its own blind spot on a UI that had moved on.
// ATLAS_AT reads the pages out of a commit instead, so the atlas can be put back
// to the day the reports were written.
const AT = process.env.ATLAS_AT
const readPage = (slug) => {
  if (!AT) {
    const p = path.join(ATLAS, `${slug}.md`)
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null
  }
  try {
    return execFileSync("git", ["show", `${AT}:${ATLAS_DIR}/${slug}.md`], { cwd: CONSUMER, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return null
  }
}

/** The atlas slug for a route, matching what capture.mjs writes. */
const slugFor = (url) =>
  url
    .split("?")[0]
    .replace(/^\//, "")
    .replace(/[/[\]#]/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "") || "index"

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out = {}
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/)
    if (kv) out[kv[1]] = kv[2]
  }
  return out
}

/**
 * The UI elements a report names. Test ids and quoted labels are the two things
 * a reader could look up in the atlas; prose is not checkable either way.
 *
 * ⚠ Code identifiers are excluded on purpose. `quote-editor-client.tsx:103` is
 * evidence about the SOURCE, and the atlas never claimed to carry that — counting
 * it as a miss would measure the wrong promise (principle 2).
 */
function anchorsOf(body) {
  const anchors = new Set()
  for (const m of body.matchAll(/`([a-z][a-z0-9-]{3,})`/g)) {
    const t = m[1]
    if (/\.(tsx?|mjs|json)$/.test(t) || t.includes("/")) continue
    anchors.add(t)
  }
  // Hungarian quotes around a UI label, e.g. „Rendeléssé alakítás"
  for (const m of body.matchAll(/„([^„"\n]{3,40})"/g)) anchors.add(m[1])
  return [...anchors]
}

/**
 * Is this string a UI element at all?
 *
 * ⚠ Without this the denominator was noise. Measured on the first run: of the
 * seven anchors taken out of one report, one was the CHANGE's name
 * (`ajanlat-ugy-alapu-modell`) and one was half a sentence the reporter spoke
 * („megtartsuk a két felületet szerinted?"). Neither could ever appear on a
 * screen, and counting them as things the atlas failed to carry would have
 * invented a blind spot out of the report's prose.
 *
 * The test is the consumer's own source: a string that appears nowhere in it is
 * not an element of the interface. This is the §2g rule — before scoring an arm
 * on a question, check the question is answerable from what the arm was given.
 */
function isInterfaceString(s) {
  try {
    execFileSync("git", ["grep", "-q", "-F", "--", s, "--", "src"], { cwd: CONSUMER, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name))
    else if (e.name === "bug.md") files.push(path.join(dir, e.name))
  }
}
walk(BUGS)

const rows = []
for (const file of files) {
  const text = fs.readFileSync(file, "utf8")
  const fm = frontmatter(text)
  if (!fm.id || (wanted.length && !wanted.includes(fm.id))) continue
  const body = text.slice(text.indexOf("---", 4) + 3)

  const slug = fm.pageUrl ? slugFor(fm.pageUrl) : null
  const atlas = slug ? readPage(slug) : null
  const onDisk = atlas !== null

  const named = anchorsOf(body)
  const anchors = named.filter(isInterfaceString)
  const prose = named.filter((a) => !anchors.includes(a))
  const found = anchors.filter((a) => (atlas ?? "").includes(a))
  rows.push({ id: fm.id, type: fm.type ?? "?", slug, onDisk, anchors, prose, found, title: (fm.title ?? "").slice(0, 64) })
}

if (!rows.length) throw new Error(`No bug file matched${wanted.length ? ` ${wanted.join(", ")}` : ""} under ${BUGS}`)

console.log(`Atlas read from: ${AT ? `commit ${AT}` : "the working tree"}`)
console.log(`Evidence coverage — ${rows.length} report${rows.length > 1 ? "s" : ""} filed by people, checked against the atlas\n`)
console.log(`  id         type     screen in atlas    UI anchors   carried   (prose dropped)`)
for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
  const inAtlas = r.slug ? (r.onDisk ? `✓ ${r.slug}` : `✗ ${r.slug}`) : "— no pageUrl"
  console.log(`  ${r.id.padEnd(10)} ${r.type.padEnd(8)} ${inAtlas.padEnd(17)} ${String(r.anchors.length).padStart(8)}   ${String(r.found.length).padStart(7)}   ${String(r.prose.length).padStart(6)}`)
}

const noPage = rows.filter((r) => !r.onDisk)
const noAnchor = rows.filter((r) => r.onDisk && r.anchors.length && !r.found.length)
console.log(`\n  screen missing from the atlas : ${noPage.length}${noPage.length ? "  → " + noPage.map((r) => r.id).join(", ") : ""}`)
console.log(`  screen present, no anchor found: ${noAnchor.length}${noAnchor.length ? "  → " + noAnchor.map((r) => r.id).join(", ") : ""}`)

console.log(`\n--- per report, which named elements the atlas does and does not carry ---`)
for (const r of rows) {
  console.log(`\n${r.id} · ${r.type} · ${r.title}`)
  if (!r.onDisk) {
    console.log(`   ⚠ ${r.slug ? `no atlas page for ${r.slug}` : "the report names no page"} — the atlas could not have helped here`)
    continue
  }
  const missing = r.anchors.filter((a) => !r.found.includes(a))
  if (r.found.length) console.log(`   carried : ${r.found.slice(0, 8).join(" · ")}${r.found.length > 8 ? ` … +${r.found.length - 8}` : ""}`)
  if (missing.length) console.log(`   absent  : ${missing.slice(0, 8).join(" · ")}${missing.length > 8 ? ` … +${missing.length - 8}` : ""}`)
}

console.log(`\n⚠ "Carried" is a NECESSARY condition, never a hit. It says the fact was on the page,`)
console.log(`  not that a reader would have noticed it. The one measurement that settles that`)
console.log(`  needs blind agents and a pre-registered list — see docs/allapot.md §2c.`)
