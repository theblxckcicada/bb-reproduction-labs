"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { topicMatches, canSubscribeLiteral, canSubscribeFixed, parseStomp, stompFrame } = require("../src/server");

test("wildcard dispatch matches concrete board and admin topics", () => {
  assert.equal(topicMatches("/topic/**", "/topic/boards/99002"), true);
  assert.equal(topicMatches("/topic/**", "/topic/admin/organizations/72002"), true);
});

test("vulnerable authorization denies a foreign board but permits the wildcard", () => {
  const viewer = { orgId: 71001 };
  assert.equal(canSubscribeLiteral(viewer, "/topic/boards/99002"), false);
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
