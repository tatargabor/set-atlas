// The compressor — raw Playwright aria-snapshot YAML → compact surface map.
//
// The question it answers: what part of a screen matters when you're about to
// design on it? Not the data (row 200 of an order list tells you nothing about
// the screen), but the structure: menus, buttons, tabs, filters, fields, table
// columns — and where the links lead.
//
// Measured (a 35-screen Next.js ERP, 2026-08-04): 147k tokens → 24.6k tokens.

/** ARIA roles that describe the SURFACE. Everything else is content. */
const STRUCTURAL_ROLES =
  /^(button|link|tab|tablist|textbox|searchbox|combobox|checkbox|radio|switch|slider|spinbutton|menuitem|option|heading|dialog|alert|status|navigation|main|banner|contentinfo|region|form|table|columnheader|listbox|menu|menubar|progressbar)\b/

/**
 * Detects data-shaped accessible names.
 *
 * A list card's name describes the RECORD ("Jane Doe … INV-00303 … €312.45"),
 * not the interface. Keeping it causes two problems: real (often personal) data
 * leaks into the map, and every new record rewrites the file — the diff turns to
 * noise and the "did the UI change?" gate becomes useless.
 */
const DATA_LIKE = /\d{2}[-.:]\d{2}|\d[\d.,\s]{3,}\s*(Ft|EUR|USD|GBP|€|\$|£)|\b[A-Z]{1,3}-\d{3,}\b/

/**
 * An email address in an accessible name is a person, never a control.
 *
 * ⚠ Measured 2026-08-04: a consumer's partner-picker page shipped 340 lines of real
 * customer names and addresses into its generated atlas — 5,640 tokens, a
 * fifth of the whole thing — because DATA_LIKE only knew dates,
 * amounts and record ids. It is checked BEFORE the length gate: ". foo@bar.hu"
 * is nineteen characters and still a customer.
 */
const EMAIL_LIKE = /[\w.+-]+@[\w-]+\.\w{2,}/

const MIN_DATA_NAME_LENGTH = 25

/**
 * Is this accessible name a record rather than a piece of interface?
 *
 * Exported because the region map (src/render-map.mjs) writes control names from
 * the DOM, not from the aria snapshot, and would otherwise reintroduce the exact
 * leak this rule exists to stop — one redaction rule, two renderers.
 */
export function isRecordName(name, dataPatterns = []) {
  if (!name) return false
  if (EMAIL_LIKE.test(name)) return true
  // The consumer's own patterns run ALONGSIDE the built-ins and ignore the length
  // gate. Measured 2026-08-04: `"FIKTÍVFA Kft. lenyitása"` — a record name wrapped
  // in an action — is 23 characters and holds no date, amount or id, so every
  // built-in rule let it through; 17 real company names sat in the atlas for a day.
  // No built-in CAN catch it: "a word that marks a company" is language-specific,
  // and baking one language's forms into a general tool fails silently on the next
  // app, in the direction that leaks.
  for (const p of dataPatterns) if (p.test(name)) return true
  return name.length >= MIN_DATA_NAME_LENGTH && DATA_LIKE.test(name)
}

export const RECORD_PLACEHOLDER = "‹record›"

function anonymizeName(text, dataPatterns = []) {
  return text.replace(/"([^"]*)"/g, (whole, name) => (isRecordName(name, dataPatterns) ? `"${RECORD_PLACEHOLDER}"` : whole))
}

function parseLines(yamlText) {
  return yamlText.split("\n").map((line) => {
    const indent = line.match(/^\s*/)[0].length
    const content = line.trim().replace(/^-\s*/, "")
    return { indent, content, role: content.match(/^([a-z]+)/)?.[1] ?? "" }
  })
}

/**
 * @param {string} yamlText  raw output of `page.ariaSnapshot()`
 * @returns {{ text: string, droppedDataLines: number }}
 */
export function compress(yamlText, { dataPatterns = [] } = {}) {
  const lines = parseLines(yamlText)
  const kept = []
  let i = 0
  let droppedDataLines = 0

  while (i < lines.length) {
    const line = lines[i]

    // Table data: the whole row/rowgroup block goes, but the column headers
    // (the column structure — part of the interface) are lifted out.
    if (line.role === "rowgroup" || line.role === "row") {
      const headers = []
      const start = i
      i++
      while (i < lines.length && lines[i].indent > line.indent) {
        if (lines[i].role === "columnheader") {
          headers.push(lines[i].content.replace(/^columnheader\s*/, "").replace(/^"|"$/g, ""))
        }
        i++
      }
      droppedDataLines += i - start
      if (headers.length) kept.push({ indent: line.indent, content: `columns: ${headers.join(" · ")}` })
      continue
    }

    // Free text and images describe the content, not the surface.
    if (line.role === "text" || line.role === "paragraph" || line.role === "img") {
      i++
      continue
    }

    if (!line.content || !STRUCTURAL_ROLES.test(line.content)) {
      i++
      continue
    }

    kept.push({ indent: line.indent, content: line.content })
    i++
  }

  // Collapse repeated siblings.
  //
  // ⚠ The collapse key is the FULL (anonymized) text — including the name.
  // An earlier version normalized names away too, so eleven distinct menu items
  // collapsed into a single `link "…"` row: the navigation disappeared, which is
  // the very thing the map exists for. Guarded by test/compress.test.mjs.
  const merged = []
  for (let j = 0; j < kept.length; j++) {
    const key = anonymizeName(kept[j].content, dataPatterns)
    let count = 1
    while (j + count < kept.length && kept[j + count].indent === kept[j].indent && anonymizeName(kept[j + count].content, dataPatterns) === key) {
      count++
    }
    merged.push(" ".repeat(kept[j].indent) + "- " + key + (count > 1 ? `   (× ${count})` : ""))
    j += count - 1
  }

  return { text: merged.join("\n"), droppedDataLines }
}

/** Rough token estimate — ~3.3 characters per token for mixed-language text. */
export const estimateTokens = (text) => Math.round(text.length / 3.3)
