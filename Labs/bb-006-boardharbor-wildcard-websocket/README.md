# BoardHarbor Wildcard WebSocket Leak

BoardHarbor is a local, fictional work-management product that faithfully
reproduces the authorization/dispatch mismatch documented in the source bug
bounty report. It is a working multi-tenant application rather than an exploit
page or payload generator.

## Fidelity to the reported behavior

| Reported behavior | BoardHarbor implementation |
|---|---|
| Lowest-privilege Viewer in one organization | Avery, `VIEWER`, Northwind Studio (`orgId=71001`) |
| Separate controlled victim organization | Morgan, `EDITOR`, Contoso Workshop (`orgId=72002`) |
| Private foreign board | Product Launch (`boardId=99002`) |
| Bearer with `sub`, `orgId`, and `userType` claims | Locally signed one-hour JWT from the normal login flow |
| SockJS transport carrying STOMP 1.2 | `/websocket/{server}/{session}/websocket` |
| Frontend origin required by the handshake | WebSocket upgrades require the exact application origin |
| Foreign REST request returns `404` | `GET /api/boards/99002` returns `404` to Avery |
| Exact foreign topic is denied | `/topic/boards/99002` returns STOMP `ERROR: Access denied` |
| Recursive wildcard is accepted | `/topic/**` is registered in vulnerable mode |
| Ordinary victim activity leaks live | Full private board and administrative events are delivered |
| Recommended wildcard rejection fixes the issue | `BROKER_MODE=fixed` rejects client patterns |

Vendor names, domains, people, and identifiers are deliberately replaced.
Protocol shape, roles, controls, vulnerable decision, and observable result are
preserved.

## Run

Requires Node.js 20 or newer.

```powershell
cd F:\Workspace\Projects\Development\01-Security-Labs\bb-reproduction-labs\Labs\bb-006-boardharbor-wildcard-websocket
npm install
npm start
```

Open <http://127.0.0.1:5080>. After startup, no additional npm command is
required.

## Controlled accounts

| Organization | Role | Email | Password |
|---|---|---|---|
| Northwind Studio | Viewer | `avery@northwind.test` | `Northwind!2026` |
| Contoso Workshop | Editor | `morgan@contoso.test` | `Contoso!2026` |

Use separate browser profiles or one normal and one private window so the
sessions remain genuinely isolated.

## Participant task

Investigate the application as a normal user:

1. Observe how the web client authenticates its REST and realtime traffic.
2. Establish the access-control boundary between the two organizations.
3. Build a Python or shell-driven SockJS/STOMP client against the running
   WebSocket endpoint.
4. Preserve a negative control before testing destination patterns.
5. Generate normal activity as the second controlled user and capture evidence.

The normal BoardHarbor UI contains no exploit helper, realtime inspector, or
button that generates victim traffic. Detailed commands and reference clients
are available only through the lab platform's **Reveal Solution** section.

## Reference solution formats

The revealed solution supports either:

- `solution/poc.py` — the direct Python SockJS/STOMP client, using
  `websocket-client`.
- `solution/poc.sh` — a POSIX shell launcher for the same client.

Neither uses npm. The victim action remains manual in the second browser
session; the reference client never receives Morgan's token.

## Architecture

The vulnerable code intentionally separates subscription authorization from
broker dispatch. `canSubscribeLiteral` authorizes the literal destination
submitted by the client. `topicMatches` later applies Ant-style `*` and `**`
matching. A concrete foreign topic resolves to an object and is denied, while a
pattern resolves to no protected object during authorization and is expanded
only during delivery.

Fixed mode rejects wildcard characters before registration and retains the
normal concrete-topic authorization checks.

## Safety

All accounts and data are synthetic. The intentionally vulnerable service
binds to `127.0.0.1` by default and should not be exposed on a shared or public
network. Tokens are signed with an in-memory key, expire after one hour, and
become invalid whenever the server restarts.
