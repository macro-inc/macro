import { expect, test } from "bun:test";
import { gmailApi, readOnly } from "../gmail.ts";
import { noon, raw } from "./helpers.ts";

type Request = { readonly url: string; readonly init: RequestInit | undefined };

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status });

/** Gmail, answering from a table of paths. Records every request it gets. */
const api = (answer: (path: string, request: Request) => Response) => {
	const requests: Request[] = [];
	let now = noon;
	let tokens = 0;
	const box = gmailApi({
		credentials: async () => ({
			clientId: "id",
			clientSecret: "SECRET",
			refreshToken: "REFRESH",
		}),
		fetch: async (url, init) => {
			requests.push({ url, init });
			if (url.includes("oauth2")) {
				tokens++;
				return json({ access_token: `token-${tokens}`, expires_in: 3600 });
			}
			return answer(url.split("/users/me/")[1] ?? "", { url, init });
		},
		clock: { now: () => now },
	});
	return {
		box,
		requests,
		tokens: () => tokens,
		advance: (hours: number) => {
			now = now.add({ hours });
		},
	};
};

test("history lists what was added, across pages, and moves the position", async () => {
	const { box } = api((path) =>
		path.includes("pageToken=p2")
			? json({
					history: [{ messagesAdded: [{ message: { id: "c" } }] }],
					historyId: "130",
				})
			: json({
					history: [
						{
							messagesAdded: [
								{ message: { id: "a" } },
								{ message: { id: "b" } },
							],
						},
						{},
						{ messagesAdded: [{ message: { id: "a" } }] },
					],
					historyId: "120",
					nextPageToken: "p2",
				}),
	);
	expect(await box.since("100")).toEqual({
		kind: "ok",
		ids: ["a", "b", "c"],
		position: "130",
	});
});

test("a forgotten position says so; any other failure throws without the response", async () => {
	const { box } = api((path) =>
		path.startsWith("history")
			? json({ error: "gone" }, 404)
			: json({ error: "SECRET in the body" }, 500),
	);
	expect(await box.since("1")).toEqual({ kind: "expired" });
	await expect(box.position()).rejects.toThrow("gmail profile: 500");
	await expect(box.search("newer_than:14d")).rejects.toThrow(
		"gmail messages: 500",
	);
	await expect(box.get("x")).rejects.toThrow("gmail get: 500");
});

test("a mail that is gone is undefined, and one that is there is parsed", async () => {
	const { box } = api((path) =>
		path.startsWith("messages/gone") ? json({}, 404) : json(raw({ id: "a" })),
	);
	expect(await box.get("gone")).toBeUndefined();
	expect((await box.get("a"))?.threadId).toBe("t-a");
});

test("the token is asked for once, renewed when it runs out, and never in a URL", async () => {
	const { box, requests, tokens, advance } = api(() => json({ historyId: 7 }));
	expect(await box.position()).toBe("7");
	await box.position();
	expect(tokens()).toBe(1);
	advance(2);
	await box.position();
	expect(tokens()).toBe(2);
	for (const { url } of requests) {
		expect(url).not.toContain("SECRET");
		expect(url).not.toContain("REFRESH");
		expect(url).not.toContain("token-");
	}
});

test("sending posts the message, base64url, in its thread; a read-only mailbox can't", async () => {
	const { box, requests } = api(() => json({ id: "sent-9" }));
	expect(await box.send("To: ada@example.com\r\n\r\nhé?", "t-a")).toEqual({
		id: "sent-9",
	});
	const sent = requests.find(({ url }) => url.endsWith("messages/send"));
	expect(sent?.init?.method).toBe("POST");
	expect(String(sent?.init?.body)).toContain('"threadId":"t-a"');
	expect(String(sent?.init?.body)).not.toMatch(/[+/=]"/);
	expect(Object.keys(readOnly(box)).sort()).toEqual([
		"get",
		"position",
		"search",
		"since",
	]);
});
