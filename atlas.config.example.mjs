// set-atlas configuration — copy to `atlas.config.mjs` in your repo root.

export default {
  baseUrl: process.env.ATLAS_BASE_URL || "http://localhost:3000",

  // Where the generated pages go (relative to the repo root).
  outDir: "docs/atlas",

  // Next.js App Router defaults. For other frameworks, supply the source file
  // yourself from the `pointers()` hook.
  appDir: "src/app",
  alias: { "@/": "src/" },

  // Called once, before the first screen. Programmatic login is recommended:
  // UI login is hydration-dependent and flaky in dev mode.
  async login(page, baseUrl) {
    const req = page.context().request
    const { csrfToken } = await (await req.get(`${baseUrl}/api/auth/csrf`)).json()
    await req.post(`${baseUrl}/api/auth/callback/credentials`, {
      form: { csrfToken, email: process.env.ATLAS_EMAIL, password: process.env.ATLAS_PASSWORD, redirect: "false" },
    })
  },

  // Extra patterns that mark a name as RECORD DATA, redacted to `‹record›`.
  //
  // These run alongside the built-in rules (email, date, amount, record id) and
  // ignore their length gate. You need them when your app wraps record names in
  // action labels — measured on a real app: `"ACME Ltd. expand"` is 17 characters
  // and holds no date, amount or id, so every built-in rule let it through and 17
  // live company names sat in the generated atlas. What marks a company (or a
  // person, or a project) is specific to your data and your language, so only you
  // can declare it.
  //
  //   dataPatterns: [/\p{Lu}[\p{L}\d\s.&-]*?\b(Ltd|Inc|GmbH|Kft|Zrt)\b\.?/u],
  //
  // ⚠ Match the WHOLE record name, not just the word that marks it. `/\b(Ltd)\b/`
  // turns "ACME Ltd. expand" into "ACME ‹record› expand" — the company name stays.
  // The form above takes the capitalised run in front of the marker with it.
  //
  // Only the match is replaced, so the action around it survives:
  // `"ACME Ltd. expand"` → `"‹record› expand"`. Measured — replacing the whole
  // label instead cost every such action its name, and ACTIONS.md could no longer
  // answer whether an "expand" action exists at all.
  //
  // ⚠ Check the output after adding one: too broad a pattern silently erases the
  // action names you need to design with.

  // The screens to record.
  //
  // `url`     — what the browser visits (a real id for dynamic routes)
  // `pattern` — the route PATTERN; drives the file name and the source lookup
  //             (`[id]` stays as-is, so the map is stable across records)
  // `actions` — setup steps for screens that only exist after interaction
  //             (dialogs, tabs) — same vocabulary as screenshot manifests
  routes: [
    { url: "/", pattern: "/", title: "Dashboard" },
    { url: "/orders", pattern: "/orders", title: "Order list" },
    { url: "/orders/8f3c-1a2b", pattern: "/orders/[id]", title: "Order detail" },
    {
      url: "/orders",
      pattern: "/orders#new-dialog",
      title: "New order dialog",
      actions: [{ click: "button:has-text('New order')" }, { wait: 600 }],
    },
  ],

  // Project-specific pointers: "where else can I read about this screen?"
  // `source`, `components` and `actions` are filled in automatically.
  pointers(route) {
    const section = route.pattern.split("/")[1] || "introduction"
    return {
      manual: `docs/manual/chapters/*-${section}.md`,
      screenshot: `docs/manual/assets/${section}.png`,
    }
  },
}
