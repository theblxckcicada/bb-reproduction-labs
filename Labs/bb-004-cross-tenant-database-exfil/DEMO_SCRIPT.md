# Demo Script — Cross-Tenant Data Exfiltration via Backup Restore (BOLA)

## Opening

This demo shows a Broken Object Level Authorization flaw in a normal-looking multi-tenant
managed-database platform, **Meridian**. When you provision a database you can restore it
from an existing backup by id. The platform checks that the backup *exists* but not that it
*belongs to your organization* — so one tenant can restore and read another tenant's data.

The platform starts empty: we create both sides of the scenario ourselves.

Two authentication planes matter here: humans sign in to the console with **email +
password** (session cookie), while terminals and CI use **API keys** against `/v1`. The
console and the API call the same handlers, so the flaw shows up in both.

## Scene 1: Create the victim tenant and put data in it

1. On the sign-in screen choose **Create account**. Sign up as "Omar Reyes",
   `omar@northstar.test`, with a password, org "Northstar Analytics". You land in the console
   as admin.
2. **Databases → Provision database**: create `customer-ledger`.
3. In the records panel, add a couple of records (one `field: value` per line) — include a
   line `note: CROSS_TENANT_PROOF` so the theft is provable.
4. **Backups → Back up now**, and use **Copy id** on the backup card.

Narration point: this is an ordinary tenant with ordinary private data and a routine backup.

## Scene 2 (optional): The read-only contractor is the discovery vector

1. **Members → Invite a member**, role `reader`. Generate the one-time link (no email is sent).
2. In a separate session, open the `/join/{code}` link, sign in (or create an account) as
   "PulseWatch Monitoring" — you are added to Northstar as a `reader`.
3. Open **Backups**: the reader can see the backup and its id.
4. Open **Databases**: record contents are hidden and there is no provision form — the
   reader cannot read records or create databases. (On the **API keys** page they could mint
   a reader key for monitoring tools.)

Narration point: the read-only access leaks nothing but an identifier. On its own it is
harmless — exactly the kind of key handed to a monitoring vendor or dropped in CI logs.

## Scene 3: Create the attacker tenant

1. Open the **user menu → Sign out**. Choose **Create account** again — "Dana Okafor",
   `dana@atlas.test`, org "Atlas Labs".
2. You are now admin of a completely separate organization. (The top-bar **org switcher**
   shows how one account could hold several orgs — but the exploit needs the attacker to be
   a non-member of the victim org, so this is a fresh account.)

## Scene 4: The controls (the platform *can* authorize objects)

As the Atlas admin, show via the API that:

- a random `sourceBackupId` is rejected → **400** (existence is validated),
- reading the victim backup directly returns **404** (cross-tenant reads are scoped),
- a cross-tenant `projectId` is rejected → **403** (sibling ownership is checked).

Narration point: object-level authorization clearly exists elsewhere — which makes the next
step a genuine oversight, not intended behaviour.

## Scene 5: The exploit

1. Still as the Atlas admin, open **Databases → Provision database**.
2. Name it `stolen-from-northstar`, paste Northstar's backup id into **Restore from backup
   id**, and submit.
3. The database is created in **Atlas's own org** with Northstar's record count.
4. The records table shows Northstar's rows, including the `CROSS_TENANT_PROOF` marker.

Narration point: the attacker never left their own organization in the URL. They only
referenced a foreign object by id — and the missing ownership check did the rest.

## Closing remediation points

- Scope every user-supplied object reference to the caller's organization — resolve
  `sourceBackupId` with the same org-scoped lookup already used for `projectId` and for
  direct backup reads.
- Reject cross-organization references with 403/404.
- Add a regression test for each object reference on every create/update path.
- Treat read-only keys as a real part of the threat model: assume their visible identifiers
  can be turned into access elsewhere.
