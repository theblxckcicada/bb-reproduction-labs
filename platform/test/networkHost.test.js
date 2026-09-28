"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildHttpOrigin,
  formatUrlHost,
  isWildcardHost,
  resolveConnectHost,
} = require("../src/networkHost");

test("wildcard bind hosts resolve to matching loopback destinations", () => {
  assert.equal(resolveConnectHost("0.0.0.0"), "127.0.0.1");
  assert.equal(resolveConnectHost("::"), "::1");
  assert.equal(resolveConnectHost("[::]"), "::1");
});

test("explicit bind hosts remain unchanged", () => {
  assert.equal(resolveConnectHost("localhost"), "localhost");
  assert.equal(resolveConnectHost("192.168.1.42"), "192.168.1.42");
  assert.equal(resolveConnectHost("::1"), "::1");
});

test("wildcard detection handles IPv4 and bracketed IPv6", () => {
  assert.equal(isWildcardHost("0.0.0.0"), true);
  assert.equal(isWildcardHost("::"), true);
  assert.equal(isWildcardHost("[::]"), true);
  assert.equal(isWildcardHost("127.0.0.1"), false);
});

test("HTTP origins format IPv6 hosts with brackets", () => {
  assert.equal(formatUrlHost("::1"), "[::1]");
  assert.equal(buildHttpOrigin("::1", 4100), "http://[::1]:4100");
  assert.equal(buildHttpOrigin("127.0.0.1", 4100), "http://127.0.0.1:4100");
});

test("HTTP origins reject invalid ports", () => {
  assert.throws(() => buildHttpOrigin("localhost", 0), RangeError);
  assert.throws(() => buildHttpOrigin("localhost", 65536), RangeError);
  assert.throws(() => buildHttpOrigin("localhost", 4100.5), RangeError);
});
