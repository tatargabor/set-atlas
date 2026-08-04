// "Where's more information?" — the pointers an agent follows to dig deeper.
//
// This is what makes aggressive compression safe: the page doesn't have to carry
// everything, because it SAYS where the rest lives. (Same principle as llms.txt.)
//
// Every field is GENERATED — no hand-maintained list that can silently rot.

import fs from "node:fs"
import path from "node:path"

/** `/orders/[id]/invoice` → `src/app/orders/[id]/invoice/page.tsx` */
export function resolveSourceFile(routePattern, { root, appDir = "src/app" }) {
  const segments = routePattern.replace(/^\//, "").split("#")[0]
  for (const candidate of ["page.tsx", "page.ts", "page.jsx", "page.js", "route.ts"]) {
    const file = path.join(root, appDir, segments, candidate)
    if (fs.existsSync(file)) return path.relative(root, file)
  }
  return null
}

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:[\w*{},\s]+\s+from\s+)?["']([^"']+)["']/g
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g

function resolveImport(spec, fromFile, { root, alias = { "@/": "src/" } }) {
  let rel = spec
  for (const [prefix, target] of Object.entries(alias)) {
    if (spec.startsWith(prefix)) rel = spec.replace(prefix, target)
  }
  const base = rel.startsWith(".") ? path.join(path.dirname(fromFile), rel) : path.join(root, rel)
  for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"]) {
    const file = base + ext
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file
  }
  return null
}

/**
 * The project's own modules behind a screen — transitively, starting at the page.
 * `node_modules` and design-system primitives are skipped: they say nothing about
 * what the screen DOES.
 *
 * Returns `{ file, depth }` entries. **Depth is not decoration** — it is the
 * difference between "this screen offers that action" and "something twelve
 * imports away can reach it". An earlier version dropped depth, and the result
 * was that `/orders` and `/orders/[id]` produced an identical ~130-entry action
 * list from which no entry-point claim could be derived. Measured 2026-08-04.
 */
export function collectComponents(sourceFile, config, { maxDepth = 3, skip = /\/ui\/|node_modules/ } = {}) {
  const { root } = config
  const depthOf = new Map()

  const walk = (file, depth) => {
    if (depth > maxDepth) return
    // Re-walk on a shorter path: the first visit may have arrived deep.
    if (depthOf.has(file) && depthOf.get(file) <= depth) return
    depthOf.set(file, depth)
    let src
    try {
      src = fs.readFileSync(file, "utf-8")
    } catch {
      return
    }
    for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(src))) {
        const resolved = resolveImport(m[1], file, config)
        if (!resolved || skip.test(resolved) || !resolved.startsWith(root)) continue
        walk(resolved, depth + 1)
      }
    }
  }

  const entry = path.join(root, sourceFile)
  walk(entry, 0)
  depthOf.delete(entry) // the page itself is `source`, not a component

  return [...depthOf.entries()]
    .map(([file, depth]) => ({ file: path.relative(root, file), depth }))
    .sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file))
}

// Group 1 marks a whole-clause type import (`import type { … }`), which must be
// dropped entirely — a type is not a callable action.
const NAMED_IMPORT_RE = /import\s*(type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g

/**
 * Server actions the screen actually uses.
 *
 * ⚠ The rule is NAMED IMPORT, not module export. An earlier version listed every
 * export of every `"use server"` module the walk reached, which conflated "this
 * button calls it" with "a module somewhere exports it" — 130 entries where a
 * handful are real. What makes an action belong to a screen is that one of its
 * components imports it *by name*.
 *
 * Each hit carries the depth of the importing component, so a reader can tell a
 * direct action from one buried deep in the tree.
 *
 * @param {{file: string, depth: number}[]} components
 * @returns {{name: string, module: string, depth: number}[]} sorted, shallowest first
 */
export function collectServerActions(components, config) {
  const { root } = config
  const isServerModule = new Map()

  const serverModule = (file) => {
    if (!isServerModule.has(file)) {
      let src = ""
      try {
        src = fs.readFileSync(file, "utf-8")
      } catch {
        /* unreadable → not a server module */
      }
      isServerModule.set(file, /^\s*["']use server["']/m.test(src))
    }
    return isServerModule.get(file)
  }

  const found = new Map()
  for (const { file, depth } of components) {
    const abs = path.join(root, file)
    let src
    try {
      src = fs.readFileSync(abs, "utf-8")
    } catch {
      continue
    }
    NAMED_IMPORT_RE.lastIndex = 0
    let m
    while ((m = NAMED_IMPORT_RE.exec(src))) {
      if (m[1]) continue // `import type { … }` — types are not actions
      const target = resolveImport(m[3], abs, config)
      if (!target || !target.startsWith(root) || !serverModule(target)) continue
      const moduleName = path.basename(target)
      for (const raw of m[2].split(",")) {
        const spec = raw.trim()
        // Inline type specifier: `import { type OrderListItem, getOrders }`.
        // Measured 2026-08-04: without this, five type names occupied the
        // 14-slot list on /rendelesek and pushed real actions out of it.
        if (/^type\s/.test(spec)) continue
        // `foo as bar` → the exported name is what identifies the action
        const name = spec.split(/\s+as\s+/)[0].trim()
        if (!name) continue
        const key = `${moduleName}::${name}`
        if (!found.has(key) || found.get(key).depth > depth) {
          found.set(key, { name, module: moduleName, depth })
        }
      }
    }
  }

  return [...found.values()].sort(
    (a, b) => a.depth - b.depth || a.module.localeCompare(b.module) || a.name.localeCompare(b.name)
  )
}

/**
 * The full pointer set for one screen.
 * `config.pointers()` adds project-specific links (manual chapter, screenshot,
 * spec) on top of the generated ones.
 *
 * ⚠ Lists here are capped, and every cap SAYS SO in the output (`…_more`).
 * A silently truncated list is worse than a long one: the reader believes they
 * saw everything. An earlier version cut components at 12 with no marker.
 */
export function buildPointers(route, config, { maxDirect = 14, maxComponents = 12 } = {}) {
  const source = resolveSourceFile(route.pattern ?? route.url, config)
  if (!source) return { source: null, ...(config.pointers?.(route, { source: null, components: [] }) ?? {}) }

  const components = collectComponents(source, config)
  const uiComponents = components.filter((c) => /components?\//.test(c.file))
  const allActions = collectServerActions(components, config)

  // Depth ≤ 1 means: the page, or a component the page imports directly. That is
  // the layer where "this screen offers this action" is a defensible claim.
  const direct = allActions.filter((a) => a.depth <= 1)
  const deeper = allActions.length - direct.length
  const shown = direct.slice(0, maxDirect)

  const out = {
    source,
    components: uiComponents.slice(0, maxComponents).map((c) => c.file),
    ...(uiComponents.length > maxComponents ? { components_more: uiComponents.length - maxComponents } : {}),
    actions: shown.map((a) => `${a.module}::${a.name}`),
    ...(direct.length > shown.length ? { actions_more: direct.length - shown.length } : {}),
    // Not a truncation but a scope statement: these exist, they are simply not
    // this screen's own surface. Named so a reader knows the number isn't a cap.
    ...(deeper ? { actions_indirect: deeper } : {}),
  }

  return { ...out, ...(config.pointers?.(route, { source, components }) ?? {}) }
}
