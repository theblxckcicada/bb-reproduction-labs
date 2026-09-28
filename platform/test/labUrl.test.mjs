import test from "node:test";
import assert from "node:assert/strict";

import { resolveLabUrl } from "../public/assets/js/labUrl.mjs";

test("uses localhost when the platform page was opened locally", () => {
  assert.equal(
    resolveLabUrl({ port: 4100, url: "http://127.0.0.1:4100" }, { hostname: "localhost" }),
    "http://localhost:4100"
  );
});

test("uses the platform page LAN address for remote access", () => {
  assert.equal(
    resolveLabUrl({ port: 4100, url: "http://127.0.0.1:4100" }, { hostname: "192.168.1.42" }),
    "http://192.168.1.42:4100"
  );
});

test("never exposes a wildcard address as a navigation target", () => {
  assert.equal(
    resolveLabUrl({ port: 4100, url: "http://127.0.0.1:4100" }, { hostname: "0.0.0.0" }),
    "http://localhost:4100"
  );
  assert.equal(
    resolveLabUrl({ port: 4100, url: "http://[::1]:4100" }, { hostname: "[::]" }),
    "http://localhost:4100"
  );
});

test("formats browser IPv6 addresses correctly", () => {
  assert.equal(
    resolveLabUrl({ port: 4100 }, { hostname: "[2001:db8::12]" }),
    "http://[2001:db8::12]:4100"
  );
});

test("falls back to the server URL until a port is allocated", () => {
  assert.equal(
    resolveLabUrl({ port: null, url: "http://localhost:4100" }, { hostname: "localhost" }),
    "http://localhost:4100"
  );
});
