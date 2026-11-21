// Preloaded into chrome-devtools-mcp (`node --import`): its first browser
// tool call asks Chrome's DevTools endpoint (`/json/version`) for the browser
// websocket, and right after a computer is restored Chromium may not listen
// yet, so the call failed with ECONNREFUSED. This retries only that request,
// only while the connection is refused, for up to CDP_WAIT_MS; any other
// answer or error goes back unchanged. Nothing else waits: a session whose
// first turn doesn't touch the browser never pays for it.
const CDP_WAIT_MS = 10_000;
const RETRY_EVERY_MS = 200;

const fetchOnce = globalThis.fetch;

function refused(error) {
  for (let cause = error; cause; cause = cause.cause) {
    if (cause.code === "ECONNREFUSED") return true;
  }
  return false;
}

globalThis.fetch = async function fetchWaitingForChrome(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!URL.canParse(url) || new URL(url).pathname !== "/json/version") {
    return fetchOnce(input, init);
  }
  const deadline = Date.now() + CDP_WAIT_MS;
  for (;;) {
    try {
      return await fetchOnce(input, init);
    } catch (error) {
      if (!refused(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_EVERY_MS));
    }
  }
};
