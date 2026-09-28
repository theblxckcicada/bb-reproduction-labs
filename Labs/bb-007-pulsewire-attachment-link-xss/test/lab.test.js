"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp, WORKSPACE_ID } = require("../src/server");

/** Start an isolated app on an operating-system-assigned port. */
async function startLab(linkPolicy = "vulnerable") {
  const app = createApp({ linkPolicy, tokenSecret: "test-only-signing-key-with-sufficient-length" });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

/** Send and parse one test request. */
async function api(baseUrl, method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.AuthToken = token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  const parsed = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, body: parsed };
}

async function login(baseUrl, email, password) {
  const result = await api(baseUrl, "POST", "/api/auth/login", { body: { email, password } });
  assert.equal(result.status, 200);
  return result.body;
}

test("users can create multiple member accounts and use normal workspace features", async (t) => {
  const lab = await startLab();
  t.after(lab.close);

  const alice = await api(lab.baseUrl, "POST", "/api/auth/register", {
    body: { name: "Alice Rivera", email: "alice@northstar.test", password: "alice-secure-2026" },
  });
  const bruno = await api(lab.baseUrl, "POST", "/api/auth/register", {
    body: { name: "Bruno Martins", email: "bruno@northstar.test", password: "bruno-secure-2026" },
  });
  assert.equal(alice.status, 201);
  assert.equal(bruno.status, 201);
  assert.equal(alice.body.user.role, "MEMBER");
  assert.equal(bruno.body.user.role, "MEMBER");
  assert.notEqual(alice.body.user.id, bruno.body.user.id);

  const profile = await api(lab.baseUrl, "GET", "/api/me", { token: alice.body.accessToken });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.name, "Alice Rivera");
  assert.equal(profile.body.workspace.members, 20);
  assert.equal("passwordHash" in profile.body.user, false);

  const duplicate = await api(lab.baseUrl, "POST", "/api/auth/register", {
    body: { name: "Alice Again", email: "ALICE@northstar.test", password: "another-secure-2026" },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 409101);

  const signedIn = await login(lab.baseUrl, "alice@northstar.test", "alice-secure-2026");
  const hook = await api(
    lab.baseUrl,
    "POST",
    `/api/workspaces/${WORKSPACE_ID}/incoming-webhooks`,
    {
      token: signedIn.accessToken,
      body: { name: "Alice's Build Feed", channelId: "ch_launch" },
    }
  );
  assert.equal(hook.status, 201);
  assert.equal(hook.body.workspaceUserId, alice.body.user.id);

  const posted = await api(lab.baseUrl, "POST", "/api/channels/ch_launch/messages", {
    token: signedIn.accessToken,
    body: { text: "The release candidate is ready for review." },
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.body.message.author.name, "Alice Rivera");
});

test("registration rejects malformed input without creating an account", async (t) => {
  const lab = await startLab();
  t.after(lab.close);

  const invalidEmail = await api(lab.baseUrl, "POST", "/api/auth/register", {
    body: { name: "New Member", email: "not-an-email", password: "long-enough-password" },
  });
  const shortPassword = await api(lab.baseUrl, "POST", "/api/auth/register", {
    body: { name: "New Member", email: "new@example.test", password: "short" },
  });
  assert.equal(invalidEmail.status, 400);
  assert.equal(invalidEmail.body.code, 400102);
  assert.equal(shortPassword.status, 400);
  assert.equal(shortPassword.body.code, 400103);
});

test("ordinary member can plant the stored attachment-link payload while sibling fields are filtered", async (t) => {
  const lab = await startLab();
  t.after(lab.close);
  const member = await login(lab.baseUrl, "maya@northstar.test", "member-demo-2026");
  const guest = await login(lab.baseUrl, "eli@agency.test", "guest-demo-2026");

  const appInstall = await api(lab.baseUrl, "POST", "/api/apps/install", {
    token: member.accessToken,
    body: { app: "calendar" },
  });
  assert.equal(appInstall.status, 403);
  assert.equal(appInstall.body.code, 403210);

  const guestHook = await api(
    lab.baseUrl,
    "POST",
    `/api/workspaces/${WORKSPACE_ID}/incoming-webhooks`,
    { token: guest.accessToken, body: { name: "Guest hook", channelId: "ch_general" } }
  );
  assert.equal(guestHook.status, 403);

  const created = await api(
    lab.baseUrl,
    "POST",
    `/api/workspaces/${WORKSPACE_ID}/incoming-webhooks`,
    { token: member.accessToken, body: { name: "Standup Assistant", channelId: "ch_general" } }
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.workspaceUserId, "usr_member_02");

  const payload = "javascript:window.__pulsewireProof=1//https://meet.pulsewire.test/abc-defg-hij";
  const planted = await api(lab.baseUrl, "POST", created.body.postPath, {
    body: {
      text: `Join <${payload}|the meeting> or <https://meet.pulsewire.test/abc-defg-hij|use the safe link>`,
      attachments: [{ title: "STANDUP · JOIN CALL", title_link: payload, text: "Daily standup" }],
      blocks: [
        {
          type: "actions",
          elements: [
            { type: "button", text: "Unsafe", url: payload },
            { type: "button", text: "Safe", url: "https://example.test/standup" },
          ],
        },
      ],
    },
  });
  assert.equal(planted.status, 200);
  assert.equal(planted.body, "ok");

  const readback = await api(lab.baseUrl, "GET", "/api/channels/ch_general/messages", {
    token: member.accessToken,
  });
  assert.equal(readback.status, 200);
  const message = readback.body.messages.at(-1);
  assert.equal(message.attachments[0].title_link, payload);
  assert.equal(message.renderedText.some((segment) => segment.type === "link" && segment.url === payload), false);
  assert.equal("url" in message.blocks[0].elements[0], false);
  assert.equal(message.blocks[0].elements[1].url, "https://example.test/standup");
});

test("captured owner refresh token crosses the member-to-owner authorization boundary", async (t) => {
  const lab = await startLab();
  t.after(lab.close);
  const member = await login(lab.baseUrl, "maya@northstar.test", "member-demo-2026");
  const owner = await login(lab.baseUrl, "olivia@northstar.test", "owner-demo-2026");

  const memberBilling = await api(
    lab.baseUrl,
    "GET",
    `/api/workspaces/${WORKSPACE_ID}/payments/customer`,
    { token: member.accessToken }
  );
  assert.equal(memberBilling.status, 403);

  const chunkSize = Math.ceil(owner.refreshToken.length / 4);
  for (let part = 0; part < 4; part += 1) {
    const chunk = owner.refreshToken.slice(part * chunkSize, (part + 1) * chunkSize);
    const captured = await api(lab.baseUrl, "GET", `/collector/p${part}/${encodeURIComponent(chunk)}`);
    assert.equal(captured.status, 204);
  }
  const capture = await api(lab.baseUrl, "GET", "/collector/capture");
  assert.equal(capture.status, 200);
  assert.equal(capture.body.ready, true);
  assert.equal(capture.body.assembled, owner.refreshToken);

  const refreshed = await api(
    lab.baseUrl,
    "POST",
    `/api/workspaces/${WORKSPACE_ID}/refresh`,
    { body: { refreshToken: capture.body.assembled } }
  );
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.user.role, "OWNER");

  const stolenOwnerBilling = await api(
    lab.baseUrl,
    "GET",
    `/api/workspaces/${WORKSPACE_ID}/payments/customer`,
    { token: refreshed.body.accessToken }
  );
  assert.equal(stolenOwnerBilling.status, 200);
  assert.equal(stolenOwnerBilling.body.basicInfo.workspace, "Northstar Labs");
});

test("fixed policy rejects the same unsafe attachment before storage", async (t) => {
  const lab = await startLab("fixed");
  t.after(lab.close);
  const member = await login(lab.baseUrl, "maya@northstar.test", "member-demo-2026");
  const created = await api(
    lab.baseUrl,
    "POST",
    `/api/workspaces/${WORKSPACE_ID}/incoming-webhooks`,
    { token: member.accessToken, body: { name: "Standup Assistant", channelId: "ch_general" } }
  );
  const planted = await api(lab.baseUrl, "POST", created.body.postPath, {
    body: {
      text: "Join the standup",
      attachments: [
        {
          title: "STANDUP · JOIN CALL",
          title_link: "javascript:alert(1)//https://meet.pulsewire.test/abc-defg-hij",
        },
      ],
    },
  });
  assert.equal(planted.status, 400);
  assert.equal(planted.body.code, 400410);
});
