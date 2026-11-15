import { expect, test } from "bun:test";
import { invoke } from "../../../../test/invoke.ts";
import { fixedClock } from "../../../context/test/fakes.ts";
import { chatModule } from "../index.ts";

/** Just enough of a chat context to see what reaches Macro. */
const rig = () => {
	const sent: unknown[] = [];
	const recalled: number[] = [];
	const context = {
		chat: {
			send: async (channelId: string, text: string) => {
				sent.push({ op: "send", channelId, text });
				return { id: "m1" };
			},
			reply: async (channelId: string, root: string, text: string) => {
				sent.push({ op: "reply", channelId, root, text });
				return { id: "m1" };
			},
			dm: async (userId: string, text: string) => {
				sent.push({ op: "dm", userId, text });
				return { id: "m1" };
			},
		},
		history: {
			recent: async (_channelId: string, count: number) => {
				recalled.push(count);
				return [];
			},
		},
		config: { owner: "macro|owner@example.com" },
		typing: { stop: async () => undefined },
		answered: new Map(),
		clock: fixedClock("2026-11-10T01:00:00Z"),
	};
	return { context, sent, recalled };
};

test("a message is sent trimmed", async () => {
	const { context, sent } = rig();
	await invoke(chatModule, "postMessage", context, {
		channelId: "c",
		text: "  hi there\n",
	});
	expect(sent).toEqual([{ op: "send", channelId: "c", text: "hi there" }]);
});

test("an empty message or a flag is never sent", async () => {
	const { context, sent } = rig();
	for (const [made, rule] of [
		[
			await invoke(chatModule, "postMessage", context, {
				channelId: "c",
				text: " ",
			}),
			"empty message",
		],
		[
			await invoke(chatModule, "replyInThread", context, {
				channelId: "c",
				root: "r",
				text: "--help",
			}),
			"refusing to send a flag as a message",
		],
		[
			await invoke(chatModule, "dmOwner", context, { text: " -h " }),
			"refusing to send a flag as a message",
		],
		[
			await invoke(chatModule, "dmPerson", context, {
				userId: "macro|ada@example.com",
				text: "",
			}),
			"empty message",
		],
	] as const)
		expect(made.kind === "failed" && made.error).toContain(rule);
	expect(sent).toEqual([]);
});

test("a DM goes only to a Macro id", async () => {
	const { context, sent } = rig();
	const refused = await invoke(chatModule, "dmPerson", context, {
		userId: "ada@example.com",
		text: "hi",
	});
	expect(refused.kind === "failed" && refused.error).toContain(
		'must start with "macro|"',
	);
	expect(sent).toEqual([]);
});

test("recall takes 50 unless told, and a whole count from 1 to 1000", async () => {
	const { context, recalled } = rig();
	await invoke(chatModule, "recallConversation", context, { channelId: "c" });
	await invoke(chatModule, "recallConversation", context, {
		channelId: "c",
		count: 1000,
	});
	for (const count of [0, -1, 1.5, 1001]) {
		const refused = await invoke(chatModule, "recallConversation", context, {
			channelId: "c",
			count,
		});
		expect(refused.kind === "failed" && refused.error).toContain(
			"count: must be a whole number from 1 to 1000",
		);
	}
	expect(recalled).toEqual([50, 1000]);
});
