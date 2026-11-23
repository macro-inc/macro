import { expect, test } from "bun:test";
import { misplaced } from "../state.ts";

test("only memory is committed: anything tracked in another bucket, or in none, is misplaced", () => {
	expect(
		misplaced([
			"memory/shared/notes.md",
			"memory/heartbeat/merges.md",
			"private/chat/history/c.jsonl",
			"run/heartbeat/tick.json",
			"log/agent/wakes.jsonl",
			"notes.md",
			"shots/screen.png",
		]),
	).toEqual({
		local: [
			"private/chat/history/c.jsonl",
			"run/heartbeat/tick.json",
			"log/agent/wakes.jsonl",
		],
		stray: ["notes.md", "shots/screen.png"],
	});
	expect(misplaced(["memory/x"])).toEqual({ local: [], stray: [] });
});
