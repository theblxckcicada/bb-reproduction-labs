# Authoring a Lab

The platform **auto-discovers** every folder under `Labs/`. A new lab shows up
in the catalog the moment you drop it in and refresh — no platform code changes.

## Minimum requirements

A lab is any folder under `Labs/` that contains one of:

- a `package.json` with a `start` script, **or**
- a `server.js` (or `src/server.js`), **or**
- a `lab.json` describing how to run it.

The lab's HTTP server **must read its port from an environment variable**
(default `PORT`). The platform assigns a free port and injects it:

```js
const PORT = process.env.PORT || 3000;
// Recommended: bind to localhost so the vulnerable app stays off the network.
app.listen(PORT, process.env.HOST || "127.0.0.1");
```

The platform also injects `HOST` and `BASE_URL` (`http://127.0.0.1:<port>`).

With nothing else, the platform infers the title, summary, runtime, and
briefing from the folder name, `package.json`, and `README.md`. That is enough
to launch — but add a `lab.json` to curate the learning experience.

## `lab.json`

Place `lab.json` in the lab's root folder. Every field is optional; anything
omitted is inferred. The full schema is
[`platform/schema/lab.schema.json`](../platform/schema/lab.schema.json) — point
your editor's JSON schema at it (or add `"$schema"` as the examples do) for
autocomplete and validation.

```jsonc
{
  "$schema": "../../platform/schema/lab.schema.json",
  "id": "bb-007-ssrf-pdf-export",          // default: folder name
  "title": "SSRF via PDF Export",           // default: prettified folder name
  "summary": "One-line catalog blurb.",     // default: package.json description
  "difficulty": "easy | medium | hard | insane",
  "categories": ["SSRF"],                    // drives catalog filters
  "vulnType": "Server-Side Request Forgery",
  "estimatedMinutes": 35,
  "author": "Ovawatch Security",
  "reportRef": "optional id or URL (sanitized)",

  "runtime": {
    "start": "npm start",                    // default: "npm start" or `node <main>`
    "install": "npm install",                // run once when node_modules is missing
    "portEnv": "PORT",                        // env var the platform sets
    "readyPath": "/",                         // path polled for readiness
    "defaultPort": 3000,                       // documentation only
    "cwd": "",                                 // sub-dir for the start command (optional)
    "env": { "FEATURE_FLAG": "on" }           // extra non-secret env
  },

  "brief": "Markdown shown on the lab page.", // default: README body
  "objectives": ["Find the sink", "Exploit it", "Explain the fix"],
  "hints": [
    { "text": "Start with the export endpoint." },
    { "text": "What does it fetch, and who controls the URL?" }
  ],
  "solution": "Markdown walkthrough — shown only behind a spoiler gate.",
  "links": [{ "label": "Write-up", "url": "https://example.com/post" }]
}
```

### Field notes

- **Hints** are revealed one at a time and the reveal count is remembered per
  learner. Keep them progressive: nudge first, specifics later.
- **Solution** is gated behind an explicit "Reveal solution" click. Markdown
  supports headings, lists, `inline code`, fenced ``` code blocks ```, links,
  bold/italic, and blockquotes.
- **categories** power the catalog filters; reuse existing names where possible
  (e.g. `XSS`, `Open Redirect`, `Account Takeover`).
- **env** is for non-secret local defaults only. Never commit real secrets.

## Checklist for a new lab

1. Create `Labs/bb-XXX-short-slug/` with your runnable app.
2. Make the server read `process.env.PORT` and bind `127.0.0.1`.
3. Add a `lab.json` (copy one of the existing labs as a template).
4. If it has dependencies, confirm `npm install` works in the folder.
5. In the platform UI, click **Refresh** — your lab appears. Launch it and
   verify it reaches **running** and opens correctly.

## Tips

- Keep each lab single-purpose and self-contained.
- A `/health` endpoint makes readiness detection instant — set
  `runtime.readyPath` to it.
- Labs that need external services (real OAuth, etc.) should say so in the
  `brief`; set safe placeholder `runtime.env` so the app still boots.
