# Pulsewire Meeting Card Takeover

Pulsewire is a self-contained collaboration SaaS reproduction based on a
sanitized real-world bug-bounty finding. It includes a polished channel UI,
role-separated workspace accounts, incoming webhooks, message attachments,
session refresh, a local attacker collector, and an owner-only billing plane.

The lab intentionally preserves a stored-XSS chain. Run it only on a trusted
machine or isolated training network.

## Run

The lab platform starts this application for you. To run it directly:

```bash
npm install
npm start
```

Then open `http://127.0.0.1:5090`. The server honors `PORT` and `HOST`, so the
platform can assign another address without changing the application.

## Create accounts

Select **Create an account** on the sign-in screen to register as many ordinary
workspace members as you need. Each account receives its own access and refresh
tokens, profile, avatar, channel history, message identity, and webhook
ownership. New accounts always join Northstar Labs with the `MEMBER` role;
self-service registration cannot grant owner privileges.

Accounts are held in the lab's in-memory datastore and reset when the lab
process restarts.

## Seeded control accounts

Use separate browser profiles for the member and owner so each has independent
local storage.

| Role | Email | Password |
|---|---|---|
| Owner | `olivia@northstar.test` | `owner-demo-2026` |
| Member | `maya@northstar.test` | `member-demo-2026` |
| Guest control | `eli@agency.test` | `guest-demo-2026` |

The seeded users remain available for repeatable role controls. All identities
and data are synthetic.

## Challenge premise

The workspace restricts marketplace application installation to owners, but
ordinary members can create first-party incoming webhooks. Investigate whether
content accepted through that write plane is interpreted consistently by the
server and web client.

The product UI contains no exploit helper. Use browser developer tools and the
normal integration workflow. If you need the complete reproduction client and
walkthrough, use **Reveal Solution** on the lab page.

## Reference client

The solution contains a dependency-free Python client and a Bash entry point:

```bash
python solution/poc.py --base-url http://127.0.0.1:5090
bash solution/poc.sh --base-url http://127.0.0.1:5090
```

When launched through the platform, replace `5090` with the assigned lab port.
The client pauses for the single required owner click, then completes the token
exchange and authorization-boundary proof. It writes sanitized evidence without
persisting the captured credential.

### Browser compatibility

The source application passed the raw meeting link directly to `window.open()`,
which executed the `javascript:` URL in the reported Chromium version. Current
Chromium releases suppress that direct form. Pulsewire retains the same unsafe
imperative-navigation boundary through its legacy compatibility path: it opens
a same-origin meeting window, then assigns the same unchecked value to the new
window's `Location`. The payload, origin access, victim click, and resulting
credential theft are unchanged and reproduce on current browsers.

## Remediation mode

Start the application with `LINK_POLICY=fixed` to apply scheme validation to
attachment URL fields and an anchored client-side meeting-link check:

```bash
LINK_POLICY=fixed npm start
```

The same reference client is rejected when it submits the unsafe attachment.

## Validation

```bash
npm test
npm run check
```

The tests cover the member/guest permissions, storage differential, collector,
refresh-token exchange, owner-only endpoint, and fixed policy.
