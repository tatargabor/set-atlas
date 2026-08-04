// What CHANGED on the surface — not just that something did.
//
// `--check` answers a yes/no question and that is all a git hook needs. A reader
// asking "did the change I just made actually reach the UI, and where?" needs the
// lines. That question is the one nothing measures today: the tests check
// behaviour, the spec states intent, and the gap between them is exactly where a
// feature ships redundantly or unreachable.
//
// Zero runtime dependencies is a project rule, so this is a plain LCS. Atlas
// pages are line-oriented by construction and a few hundred lines long, so the
// naive table is both fast enough and exactly right.

/**
 * Above this the O(n·m) table stops being reasonable (4000² × 4 bytes = 64MB).
 * ⚠ Announced rather than silently degraded — a diff that quietly gives up on the
 * biggest page is the failure this tool exists to catch.
 */
const MAX_LINES = 4000

/** @returns {{mark: " "|"+"|"-", text: string}[]} */
export function lineDiff(before, after) {
  const a = before.split("\n")
  const b = after.split("\n")
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null

  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ mark: " ", text: a[i++] }), j++
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ mark: "-", text: a[i++] })
    else out.push({ mark: "+", text: b[j++] })
  }
  while (i < n) out.push({ mark: "-", text: a[i++] })
  while (j < m) out.push({ mark: "+", text: b[j++] })
  return out
}

/**
 * The changed lines with a little context around them, capped.
 *
 * ⚠ The cap is announced on the line after the last one shown. A truncated list
 * that looks complete is the specific bug this package exists to catch, and a
 * whole-file rewrite (a route renamed, say) would otherwise bury every other
 * screen's changes under one page's worth of noise.
 */
export function formatDiff(before, after, { context = 2, maxLines = 40 } = {}) {
  const rows = lineDiff(before, after)
  if (!rows) return [`  ⚠ the page is over ${MAX_LINES} lines — too large to diff line by line; regenerate and read it directly`]

  const keep = new Set()
  rows.forEach((row, k) => {
    if (row.mark === " ") return
    for (let d = -context; d <= context; d++) if (rows[k + d]) keep.add(k + d)
  })
  if (!keep.size) return []

  const shown = [...keep].sort((x, y) => x - y)
  const out = []
  let last = -2
  let changed = 0
  for (const k of shown) {
    if (changed >= maxLines) break
    if (k !== last + 1 && out.length) out.push("  …")
    out.push(`  ${rows[k].mark} ${rows[k].text}`)
    if (rows[k].mark !== " ") changed++
    last = k
  }
  const total = rows.filter((r) => r.mark !== " ").length
  if (changed < total) out.push(`  ⚠ ${total - changed} further changed line(s) not shown`)
  return out
}
