# BoardHarbor Wildcard WebSocket Leak

BoardHarbor is an interactive, fictional work-management application that reproduces a cross-tenant realtime data leak caused by inconsistent interpretation of STOMP subscription destinations.

## What is reproduced

- Two independent organizations and principals.
- A Viewer role with a synthetic bearer token.
- REST endpoints that correctly enforce board ownership.
- A SockJS-compatible WebSocket transport carrying STOMP 1.2 frames.
- Correct denial of an explicitly named foreign board topic.
- Vulnerable acceptance of `/topic/**` followed by broker-side wildcard expansion.
- Full private item events and administrative organization events delivered cross-tenant.
- A remediated mode that rejects wildcard destinations.

The original vendor name, domains, accounts, and identifiers are not used.

## Run

```powershell
npm install
npm start
```

Open <http://127.0.0.1:5080>. The application is presented as the normal BoardHarbor product; reproduction guidance is intentionally kept outside its UI.

Select **Create account** to create a new isolated workspace. Registration creates an Owner account, an organization, and an empty starter board, then signs the user in automatically. Accounts and board data are stored in `data/db.json` and survive server restarts.

Editors and Owners can select an item from the table, board, timeline, or My work view to update its title and status. Changes are persisted and delivered to other open sessions over the board's realtime topic.

## Test accounts

| Organization | Role | Email | Password |
|---|---|---|---|
| Northwind Studio | Viewer | `avery@northwind.test` | `Northwind!2026` |
| Contoso Workshop | Editor | `morgan@contoso.test` | `Contoso!2026` |

Use separate browser profiles for the accounts. Morgan can add items to the private Product Launch board. Avery has a different organization and board, and its normal client subscribes only to its concrete board topic.

## CLI reproduction

Keep the server running in one terminal. In another, run:

```powershell
# Exact foreign destination: Access denied
npm run poc -- /topic/boards/99002

# Vulnerable wildcard: receives Contoso's private event
npm run poc -- /topic/**

# Fixed broker: restart the server with the fix enabled
$env:BROKER_MODE = "fixed"
npm start
# Then run npm run poc -- /topic/** in another terminal
```

When the platform assigns a different port, pass its URL:

```powershell
$env:BASE_URL = "http://127.0.0.1:4100"
npm run poc -- /topic/**
```

## Architecture decision

The lab keeps authorization and broker dispatch as separate functions because that separation is the vulnerability. `canSubscribeLiteral` reproduces the flawed interceptor, while `topicMatches` models the broker's later Ant-style expansion. The fixed path rejects client-supplied patterns before any subscription is registered.

## Safety

All data and credentials are synthetic and held in memory. The server binds to `127.0.0.1` by default. Do not expose intentionally vulnerable training applications to shared or public networks.
