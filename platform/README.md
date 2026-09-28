# Ovawatch Labs — Platform

A TryHackMe-style control plane for the bug-bounty reproduction labs in this
repo. It auto-discovers every lab under `../Labs`, and lets you launch one with
a click: the platform installs dependencies (once), assigns a port, starts the
lab, waits until it is ready, streams its logs, and tears it down on demand.

```
┌────────────────────────────────────────────────────────────┐
│  Browser SPA  ──HTTP/SSE──▶  Express control plane          │
│  (catalog,                    • discovery (scan ../Labs)    │
│   console)                    • instance manager            │
│                               • port pool / health probe    │
│                                      │ spawn                 │
│                                      ▼                        │
│                          lab process @ 127.0.0.1:<port>     │
└────────────────────────────────────────────────────────────┘
```

## ⚠ Disclaimer

These labs are **intentionally vulnerable**, reproduced from real findings for
**education and authorized security research only**.

- **Run locally.** Never deploy these apps to the public internet or any
  shared/production network.
- **Stay authorized.** Only use techniques you learn here on systems you own or
  are explicitly permitted to test.
- **Sanitized.** Names, paths, and domains are changed; any resemblance to live
  systems is incidental.
- **Your responsibility.** You are accountable for complying with all applicable
  laws and program rules. The authors accept no liability for misuse.

The UI shows this on first run as an acknowledgement gate and keeps a short
version in the footer.

## Requirements

- Node.js 18+ (developed on Node 22)
- The labs are Node/Express apps; each is launched with your installed Node.

## Run

```bash
cd platform
npm install
npm start
```

Open <http://127.0.0.1:8080>. Pick a lab, read the briefing, click **Launch
lab**, then **Open Lab** once it is running.

> Optional config: copy `.env.example` to `.env` and adjust. All settings have
> safe defaults, so a `.env` file is not required.

## Configuration (`.env`)

| Variable            | Default       | Purpose                                            |
| ------------------- | ------------- | -------------------------------------------------- |
| `BRAND_NAME`        | Ovawatch Labs | UI header label                                    |
| `BIND_HOST`         | 127.0.0.1     | Interface used by the platform and launched labs   |
| `PORT`              | 8080          | Platform port                                      |
| `LABS_DIR`          | `../Labs`     | Where labs are discovered                          |
| `LAB_PORT_RANGE`    | 4100-4199     | Ports handed to launched labs                      |
| `MAX_CONCURRENT`    | 5             | Max labs running at once                           |
| `IDLE_TTL_MIN`      | 20            | Auto-stop a lab after N minutes idle               |
| `START_TIMEOUT_MS`  | 60000         | Readiness timeout when starting a lab              |
| `INSTALL_TIMEOUT_MS`| 180000        | Timeout for first-launch `npm install`             |
| `LOG_BUFFER_LINES`  | 500           | Per-lab log lines retained                         |
| `LOG_LEVEL`         | info          | `error \| warn \| info \| debug`                   |

## Adding labs

Drop a folder into `../Labs` and click **Refresh**. See
[`../docs/LAB_AUTHORING.md`](../docs/LAB_AUTHORING.md) and the JSON schema at
[`schema/lab.schema.json`](schema/lab.schema.json).

## Security model

These labs are **intentionally vulnerable**. The platform is built for **local,
single-user** use:

- The control plane binds to `127.0.0.1` by default. Keep it that way; do not
  expose it on a routable interface.
- If `BIND_HOST=0.0.0.0`, wildcard binding is used only for listening. **Open
  Lab** and **Copy URL** use the hostname or IP through which your browser
  accessed the platform (for example, `localhost` or a LAN address), never
  `0.0.0.0`.
- Launched labs receive `HOST=BIND_HOST`; with the default configuration this
  is `127.0.0.1`. Setting it to `0.0.0.0` exposes the intentionally vulnerable
  labs on every IPv4 interface, so use a trusted network and host firewall.
- The platform only ever runs the `install`/`start` commands from a lab's own
  manifest (authored alongside the lab) — it does not execute arbitrary input
  from the browser. Lab ids and working directories are validated to stay
  inside `Labs/`.
- No secrets are stored in code; configuration is environment-driven.

For multi-user or hosted deployment you would add per-user isolation
(containers), authentication, and a datastore — intentionally out of scope here.

## Project layout

```
platform/
  src/
    server.js              control-plane bootstrap (static + API + SSE)
    config.js              env-driven configuration
    labs/                  discovery, manifest inference, registry
    runtime/               port pool, health probe, process runner, instances
    routes/                REST + SSE + progress endpoints
    store/                 local progress persistence
  public/                  no-build SPA (catalog + lab console)
  schema/lab.schema.json   lab.json schema
  scripts/check.js         `npm run check` — node --check over src/
```

## Scripts

| Command         | Description                                  |
| --------------- | -------------------------------------------- |
| `npm start`     | Run the platform                             |
| `npm run dev`   | Run with `--watch` (auto-restart on changes) |
| `npm run check` | Syntax-check all source files                |

## Troubleshooting

- **A lab fails to start** — open its console; the streamed stderr usually shows
  the cause (missing dependency, a required `.env`, or a port conflict).
- **"No free port"** — raise `LAB_PORT_RANGE` or stop a running lab.
- **Port 8080 in use** — set `PORT` in `.env`.
- **Lab needs OAuth/external services** — see that lab's own README; the catalog
  brief notes when extra setup is required.
