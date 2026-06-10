# WorkNest

WorkNest is a small work-management web application for a controlled authentication-flow demonstration. It has a clean user-facing UI, local email/password authentication, Google OAuth support, and a simple project/task workspace.

> Do not deploy this project to the public internet. It is intentionally built for a local security demo.

## Stack

- Node.js + Express backend
- Server-side sessions
- Passport Google OAuth 2.0
- Local JSON file storage in `data/db.json`
- Static modern frontend served from `public/`

## Run locally

```bash
cd pre-account-takeover-worknest
npm install
cp .env.example .env
npm run start
```

Open:

```text
http://localhost:5050
```

## Google OAuth setup

Create an OAuth Client ID in Google Cloud Console using a **Web application** client.

Use these local development values:

```text
Authorized JavaScript origin: http://localhost:5050
Authorized redirect URI:     http://localhost:5050/auth/google/callback
```

Then update `.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
SESSION_SECRET=replace-this-with-a-long-random-string
BASE_URL=http://localhost:5050
PORT=5050
```

Restart the app after changing `.env`.

## Reset demo data

```bash
npm run reset
```

This deletes local users and projects by recreating `data/db.json`.

## Demo flow

Use two browser profiles or one normal window and one private/incognito window.

### Characters

- Attacker browser: email/password registration
- Victim browser: Google sign-in using the same email address

### Steps

1. Reset the app.

   ```bash
   npm run reset
   npm run start
   ```

2. In the attacker browser, create an account with the victim's email address and an attacker-chosen password.

3. Sign out.

4. In the victim browser, click **Continue with Google** and authenticate using the same Google account email.

5. Create a realistic project/task in the victim browser.

6. Sign out.

7. In the attacker browser, sign in with the victim email and the attacker-chosen password from step 2.

8. The attacker sees the same workspace data created after Google sign-in.

## Where the flawed behavior lives

The account-linking logic is in:

```text
src/auth.js
```

When a Google profile returns an email address already present in the local database, the existing account is linked to Google by email. The existing local password remains valid.

That is the behavior you are demonstrating.

## Safe fix direction

A production application should not silently trust email equality when linking a federated identity to an existing local account. Safer approaches include:

- Require the existing local password before linking Google to an existing password account.
- Send an email verification link before linking accounts.
- If a federated login verifies an existing local account, invalidate existing local credentials until the legitimate user sets a new password.
- Notify the user that a sign-in method was added.
- Store and enforce a clear account-linking state machine instead of ad-hoc merging.
