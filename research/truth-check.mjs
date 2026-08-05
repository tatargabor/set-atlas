// Content accuracy benchmark — does the map STATE a number that is wrong?
//
// The format benchmark (build-benchmark.mjs) asks whether a reader can find
// things on the map. It scored 98% while the map was printing `table (0 rows)`
// on seven screens that had 124, 103, 25, 25, 25 and 6 rows. It could not
// catch that: its own key is derived from the same region walk the bug lives in.
//
// So this one takes its truth from somewhere else. For every screen it counts
// the `<tr>` elements under a `<tbody>` in the RAW capture — no region walk, no
// repeat-run merging, no depth limit — and compares that with every `table (N)`
// the shipped renderer prints.
//
// ⚠ The independence is PARTIAL, and saying so matters more than the number.
//   Both sides read the same capture, and both know what a `tr` is. What differs
//   is the traversal and the summing — which is exactly where every measured
//   failure sat: rows leaving the region as children (the `0 rows` class), and
//   runs of 11+44+3 reported as their largest instead of their sum (the `44` class).
//   A capture that itself missed rows would fool both sides equally.
//
// ⚠ It reports DISAGREEMENT, not fault. When the two disagree one of them is
//   wrong and the tool cannot say which — build-benchmark.mjs was itself wrong
//   twice, and only unanimous readers caught it. Open the screen before calling
//   anything a bug.
//
//   ATLAS_CONSUMER=/path/to/app node research/truth-check.mjs        # every screen
//   node research/truth-check.mjs penzugy                            # one screen
//   node research/truth-check.mjs --verbose                          # print the map lines too

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { renderMap } from "../src/render-map.mjs"

const CORPUS = path.join(import.meta.dirname, "corpus")
const only = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null
const VERBOSE = process.argv.includes("--verbose")

// The consumer's record patterns change what the map prints, so the check has to
// run with the same ones the atlas would. Absent consumer → built-in rules only.
const consumerRoot = process.env.ATLAS_CONSUMER
let dataPatterns = []
if (consumerRoot) {
  const cfg = await import(pathToFileURL(path.join(consumerRoot, "atlas.config.mjs")).href).then((m) => m.default)
  dataPatterns = cfg.dataPatterns ?? []
}

/**
 * Rows of every `<table>` in the raw capture, counted straight off the parent
 * links. A `<tr>` inside `<thead>` is a header, not a row — the atlas does not
 * count it either, and including it would have made all eleven tables disagree
 * by exactly one, which reads like a real finding and is not.
 */
function domTables(nodes) {
  const tables = new Map() // table node index -> row count
  for (const n of nodes) if (n.tag === "table") tables.set(n.i, 0)
  if (!tables.size) return tables

  for (const n of nodes) {
    if (n.tag !== "tr") continue
    let inHead = false
    let owner = null
    for (let p = n.p; p >= 0; p = nodes[p].p) {
      const tag = nodes[p].tag
      if (tag === "thead") inHead = true
      if (tag === "table") {
        owner = p
        break
      }
    }
    if (owner !== null && !inHead) tables.set(owner, tables.get(owner) + 1)
  }
  return tables
}

/** Every row claim the shipped renderer prints, in the order it prints them. */
function mapClaims(text) {
  const claims = []
  for (const line of text.split("\n")) {
    const withNumber = line.match(/- table \((\d+) rows?\)/)
    if (withNumber) claims.push({ rows: Number(withNumber[1]), line: line.trim() })
    // `table` with no number is the D10 case: the renderer knows it cannot count.
    // Silence is honest, so it is reported apart from a wrong number.
    else if (/- table [#"[]/.test(line) || /- table$/.test(line.trimEnd())) claims.push({ rows: null, line: line.trim() })
  }
  return claims
}

const screens = fs
  .readdirSync(CORPUS)
  .filter((s) => fs.existsSync(path.join(CORPUS, s, "nodes.json")))
  .filter((s) => !only || s === only)
if (!screens.length) throw new Error(only ? `No such screen in the corpus: ${only}` : "The corpus is empty — run capture-corpus.mjs first.")

let agree = 0
let disagree = 0
let silent = 0
let unmatched = 0
const rows = []

for (const slug of screens) {
  const nodes = JSON.parse(fs.readFileSync(path.join(CORPUS, slug, "nodes.json"), "utf8"))
  const truth = [...domTables(nodes).values()].sort((a, b) => b - a)
  const claims = mapClaims(renderMap(nodes, { dataPatterns }).text)
  if (!truth.length && !claims.length) continue

  const claimed = claims.map((c) => c.rows)
  const numbered = claimed.filter((n) => n !== null).sort((a, b) => b - a)
  const silentClaims = claimed.filter((n) => n === null).length
  silent += silentClaims

  // Pair largest-with-largest: the map may split or merge tables, so index
  // pairing would invent mismatches out of ordering alone.
  const pairs = Math.min(truth.length, numbered.length)
  for (let k = 0; k < pairs; k++) {
    if (truth[k] === numbered[k]) agree++
    else {
      disagree++
      rows.push({ slug, dom: truth[k], map: numbered[k], line: claims.find((c) => c.rows === numbered[k])?.line ?? "" })
    }
  }
  // A table the DOM has and the map never mentions is the `0 rows` class one
  // level up: not a wrong number, an absent one.
  const missing = truth.length - numbered.length - silentClaims
  if (missing > 0) {
    unmatched += missing
    for (const n of truth.slice(numbered.length + silentClaims)) rows.push({ slug, dom: n, map: "—", line: "(the map states no table here)" })
  }

  if (VERBOSE) {
    console.log(`\n${slug}`)
    console.log(`  DOM   : ${truth.join(", ") || "no table"}`)
    console.log(`  map   : ${claims.map((c) => c.rows ?? "(no number)").join(", ") || "no table"}`)
    for (const c of claims) console.log(`          ${c.line}`)
  }
}

console.log(`\nContent accuracy — row counts, ${screens.length} screen${screens.length > 1 ? "s" : ""}`)
console.log(`  agree            ${agree}`)
console.log(`  DISAGREE         ${disagree}`)
console.log(`  map states none  ${unmatched}   (the DOM has a table the map never names)`)
console.log(`  map declines     ${silent}   (prints \`table\` with no number — D10, honest silence)`)

if (rows.length) {
  console.log(`\n  screen                        DOM     map`)
  for (const r of rows.sort((a, b) => b.dom - a.dom)) {
    console.log(`  ${r.slug.padEnd(28)} ${String(r.dom).padStart(5)}  ${String(r.map).padStart(6)}`)
    console.log(`      ${r.line.slice(0, 100)}`)
  }
  console.log(`\n⚠ Disagreement is not a verdict. Open the screen before fixing anything —`)
  console.log(`  the key has been the wrong one twice (see build-benchmark.mjs).`)
}

process.exitCode = disagree + unmatched > 0 ? 1 : 0
