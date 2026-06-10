# Northstar Store

A polished local storefront built with Node.js, Express, and session-based authentication.

## Features

- Refined landing page with a premium retail look and product catalogue
- Register and sign-in flows
- Session-based authentication using the `auth-token` session cookie key
- Protected account dashboard with profile details, recent orders, saved addresses, and saved items
- Loader route that displays `next`, `bannerText`, and `timeoutDuration` and redirects only to local destinations

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Notes

- Users are stored in memory for local development.
- Passwords are hashed with SHA-256 in this project. For production, use `bcrypt` and persistent storage.
