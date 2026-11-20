// `bun test-browser-escape.ts <url>`: opens <url> in a new tab of the
// agent's Chromium (DevTools on 127.0.0.1:9223), as the agent would, and
// prints the page's text. The VM test checks what the agent's browser can
// reach.
const devtools = "http://127.0.0.1:9223";
const url = process.argv[2] ?? "";
const tab = await (await fetch(`${devtools}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
// Long enough for a page, an error page or a refused connection.
await Bun.sleep(3000);
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
const reply = new Promise<string>((resolve) =>
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id === 1) resolve(message.result?.result?.value ?? "");
  }),
);
socket.send(
  JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression: "document.documentElement.innerText", returnByValue: true },
  }),
);
console.log(await reply);
socket.close();
await fetch(`${devtools}/json/close/${tab.id}`);
