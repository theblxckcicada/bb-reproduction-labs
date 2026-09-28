"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  topicMatches,
  canSubscribeLiteral,
  canSubscribeFixed,
  issueAccessToken,
  userFromAccessToken,
  parseStomp,
  stompFrame,
} = require("../src/server");

test("wildcard dispatch matches concrete board and admin topics", () => {
  assert.equal(topicMatches("/topic/**", "/topic/boards/99002"), true);
  assert.equal(topicMatches("/topic/**", "/topic/admin/organizations/72002"), true);
});

test("vulnerable authorization denies a foreign board but permits the wildcard", () => {
  const viewer = { orgId: 71001 };
  assert.equal(canSubscribeLiteral(viewer, "/topic/boards/99002"), false);
  assert.equal(
    canSubscribeLiteral(viewer, "/topic/admin/organizations/72002"),
    false,
  );
  assert.equal(canSubscribeLiteral(viewer, "/topic/**"), true);
});

test("fixed authorization rejects wildcard and permits the owned board", () => {
  const viewer = { orgId: 71001 };
  assert.equal(canSubscribeFixed(viewer, "/topic/**"), false);
  assert.equal(canSubscribeFixed(viewer, "/topic/boards/88001"), true);
});

test("STOMP frames round-trip", () => {
  const parsed = parseStomp(stompFrame("SUBSCRIBE", { id: "s1", destination: "/topic/**" }));
  assert.equal(parsed.command, "SUBSCRIBE");
  assert.equal(parsed.headers.destination, "/topic/**");
});

test("short-lived access tokens carry and enforce tenant claims", () => {
  const viewer = { id: 41001, orgId: 71001, role: "VIEWER" };
  const token = issueAccessToken(viewer);
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  );
  assert.equal(claims.sub, "41001");
  assert.equal(claims.orgId, 71001);
  assert.equal(claims.userType, "VIEWER");
  assert.equal(userFromAccessToken(token)?.id, 41001);

  const parts = token.split(".");
  parts[1] = Buffer.from(
    JSON.stringify({ ...claims, orgId: 72002 }),
  ).toString("base64url");
  assert.equal(userFromAccessToken(parts.join(".")), null);
});
