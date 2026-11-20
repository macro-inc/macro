// Hands each client of a unix socket its own stdio MCP server, and once one
// has been asked for keeps the next one started and loaded: a Node MCP
// server spends most of half a second loading before it can answer
// `initialize`, and Claude Code waits for its user-scope MCP servers before a
// session's first turn. Nothing runs before the first client: systemd owns
// the socket and starts this on the first connection (socket activation), so
// a computer that never has a session pays no memory for it. Closing a
// connection stops its server.
//
//   node mcp-spare.mjs <command> [args...]    (with LISTEN_FDS=1 from systemd)
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const [command, ...args] = process.argv.slice(2);
// sd_listen_fds(3): the first passed descriptor is 3.
const LISTEN_FD = 3;
if (!command || process.env.LISTEN_FDS !== "1") {
  console.error("usage: mcp-spare.mjs <command> [args...], started by a systemd socket with one listening socket");
  process.exit(64);
}
// A spare that exits before use is restarted after this long, so a server
// that can't start doesn't spin.
const RESPAWN_DELAY_MS = 1000;

let spare;

function startSpare() {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  const entry = { child, exited: false };
  child.on("exit", (code, signal) => {
    entry.exited = true;
    if (spare === entry) {
      console.error(`the spare MCP server exited before use (code ${code}, signal ${signal}); restarting`);
      spare = undefined;
      setTimeout(() => {
        spare ??= startSpare();
      }, RESPAWN_DELAY_MS);
    }
  });
  return entry;
}

// The first client's server starts now (as if the client had started it);
// every client after that finds one already loaded. The next spare starts
// once the taken server has answered: two Node servers loading at once would
// slow the one a session is waiting for.
function take() {
  const taken = spare && !spare.exited ? spare : startSpare();
  spare = undefined;
  taken.child.stdout.once("data", () => {
    spare ??= startSpare();
  });
  return taken;
}

const server = createServer((connection) => {
  const { child } = take();
  connection.pipe(child.stdin);
  child.stdout.pipe(connection);
  const stop = () => {
    child.stdin.destroy();
    child.kill("SIGTERM");
  };
  connection.on("close", stop);
  connection.on("error", stop);
  child.on("exit", () => connection.destroy());
});
server.listen({ fd: LISTEN_FD });
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    spare?.child.kill("SIGTERM");
    server.close();
    process.exit(0);
  });
}
