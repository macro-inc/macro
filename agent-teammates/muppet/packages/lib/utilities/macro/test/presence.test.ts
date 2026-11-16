import { describe, expect, test } from "bun:test";
import { stayOnline } from "../index.ts";

describe("stayOnline", () => {
	test("connects with the API key, pings, and reconnects after a drop", async () => {
		const seen: { key: string | null; messages: string[] }[] = [];
		let connections = 0;
		const server = Bun.serve<{ index: number }>({
			port: 0,
			fetch: (request, server) => {
				seen.push({
					key: request.headers.get("x-macro-user-api-key"),
					messages: [],
				});
				return server.upgrade(request, { data: { index: seen.length - 1 } })
					? undefined
					: new Response("no", { status: 400 });
			},
			websocket: {
				open: (socket) => {
					connections += 1;
					// Drop the first connection, to see it come back.
					if (connections === 1)
						setTimeout(() => socket.close(1012, "restart"), 20);
				},
				message: (socket, message) => {
					seen[socket.data.index]?.messages.push(String(message));
				},
			},
		});
		const changes: unknown[] = [];
		const online = stayOnline({
			apiKey: async () => "k3y",
			url: `ws://127.0.0.1:${server.port}`,
			ping: 30,
			onChange: (change) => changes.push(change),
		});
		await Bun.sleep(1_300);
		online.stop();
		await Bun.sleep(50);
		server.stop(true);

		expect(seen.length).toBe(2);
		expect(seen.every(({ key }) => key === "k3y")).toBe(true);
		expect(seen[1]?.messages.length).toBeGreaterThan(1);
		expect(seen[1]?.messages.every((message) => message === "ping")).toBe(true);
		expect(changes.slice(0, 3)).toEqual([
			{ online: true },
			{ online: false, code: 1012, reason: "restart" },
			{ online: true },
		]);
	});
});
