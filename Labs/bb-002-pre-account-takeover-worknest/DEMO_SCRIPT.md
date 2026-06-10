# Demo Script

## Opening

This demo shows a pre-account takeover pattern in a normal-looking work management application. The issue happens when an application allows a local account to be created for an email address, then later silently links a Google OAuth login to that existing account based only on matching email.

## Scene 1: Attacker pre-registers

1. Open Browser A.
2. Create an account using the victim email address.
3. Use an attacker-controlled password.
4. Sign out.

Narration point:

The attacker does not need access to the victim's mailbox at this stage. The app accepts the email/password account and leaves that password active.

## Scene 2: Victim signs in with Google

1. Open Browser B.
2. Click **Continue with Google**.
3. Sign in with the real Google account for that same email address.
4. Land in the workspace.

Narration point:

The application trusts the Google profile email and links it into the existing account. The victim sees a normal workspace and is not told that a password login already exists.

## Scene 3: Victim creates data

1. Create a project.
2. Add one or two tasks.
3. Sign out.

Narration point:

From the victim's perspective, everything looks normal.

## Scene 4: Attacker returns

1. Open Browser A.
2. Sign in using the victim email and the original attacker-chosen password.
3. Show the project/tasks created by the victim.

Narration point:

The original password was never invalidated, so the attacker inherits access after the victim's Google login completes account verification/fusion.

## Closing remediation points

- Do not silently link accounts only by email.
- Require the existing password or email verification before linking.
- Notify the user when a new sign-in method is added.
- Invalidate old local credentials if a federated provider verifies ownership later.
