const server = Bun.serve({
  port: 6969,
  fetch(req, server) {
    if (server.upgrade(req)) {
      return;
    }
    return new Response("WebSocket server running on port 6969", { status: 200 });
  },
  websocket: {
    open(ws) {
      console.log("Client connected");
    },
    message(ws, message) {
      console.log("Received:", message);
      ws.send("ping");
    },
    close(ws) {
      console.log("Client disconnected");
    },
  },
});

console.log(`WebSocket server listening on ws://localhost:${server.port}`);
