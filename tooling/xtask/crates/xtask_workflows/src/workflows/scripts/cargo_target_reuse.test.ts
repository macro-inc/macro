// How the Generated Code Check dates its checkout. Run by xtask_workflows' tests.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	formatRecord,
	parseRecord,
	parseTree,
	plan,
	type SourceTimes,
} from "./cargo_target_reuse.ts";

const blob = (object: string) => `100644 blob ${object}`;
const link = (object: string) => `120000 blob ${object}`;
const dir = (object: string) => `040000 tree ${object}`;
const run = (
	previous: SourceTimes | undefined,
	entries: Record<string, string>,
	now: number,
	links: Record<string, string> = {},
) =>
	plan(
		previous,
		new Map(Object.entries(entries)),
		new Map(Object.entries(links)),
		now,
	);
const times = (record: SourceTimes) =>
	Object.fromEntries([...record].map(([path, { time }]) => [path, time]));

describe("plan", () => {
	test("dates everything now without a record", () => {
		const result = run(
			undefined,
			{ crates: dir("t1"), "crates/a.rs": blob("a1") },
			100,
		);
		assert.equal(result.rebuildAll, "no record of earlier builds");
		assert.deepEqual(times(result.record), { crates: 100, "crates/a.rs": 100 });
	});

	test("keeps the time a path first had its contents; changed, added and their directories get now", () => {
		const first = run(
			undefined,
			{
				crates: dir("t1"),
				"crates/a.rs": blob("a1"),
				"crates/b.rs": blob("b1"),
			},
			100,
		);
		const second = run(
			first.record,
			{
				crates: dir("t2"),
				"crates/a.rs": blob("a1"),
				"crates/b.rs": blob("b2"),
				"crates/c.rs": blob("c1"),
			},
			200,
		);
		assert.equal(second.rebuildAll, undefined);
		assert.equal(second.changed, 3);
		assert.deepEqual(times(second.record), {
			crates: 200,
			"crates/a.rs": 100,
			"crates/b.rs": 200,
			"crates/c.rs": 200,
		});
	});

	test("counts a removal, and its directory changes", () => {
		const first = run(
			undefined,
			{
				crates: dir("t1"),
				"crates/a.rs": blob("a1"),
				"crates/b.rs": blob("b1"),
			},
			100,
		);
		const second = run(
			first.record,
			{ crates: dir("t2"), "crates/a.rs": blob("a1") },
			200,
		);
		assert.equal(second.changed, 2);
		assert.deepEqual(times(second.record), { crates: 200, "crates/a.rs": 100 });
	});

	test("contents that come back get a new time, newer than any build of the contents in between", () => {
		const first = run(undefined, { "a.rs": blob("x") }, 100);
		const second = run(first.record, { "a.rs": blob("y") }, 200);
		const third = run(second.record, { "a.rs": blob("x") }, 300);
		assert.equal(third.record.get("a.rs")?.time, 300);
	});

	test("only changed sqlx query data rebuilds everything", () => {
		const base = {
			".sqlx/q1.json": blob("q1"),
			"a.rs": blob("a"),
			"db/migrations/1.sql": blob("m1"),
		};
		const first = run(undefined, base, 100);

		// Another PR's new query or migration is missing from this one's tree.
		const added = run(
			first.record,
			{
				...base,
				".sqlx/q2.json": blob("q2"),
				"db/migrations/2.sql": blob("m2"),
			},
			200,
		);
		assert.equal(added.rebuildAll, undefined);
		const back = run(added.record, base, 300);
		assert.equal(back.rebuildAll, undefined);
		assert.equal(back.record.get("a.rs")?.time, 100);

		const modified = run(
			first.record,
			{ ...base, ".sqlx/q1.json": blob("q1b") },
			200,
		);
		assert.equal(
			modified.rebuildAll,
			".sqlx/q1.json (sqlx query data) changed",
		);
		assert.equal(modified.record.get("a.rs")?.time, 200);
	});

	test("a job's reason dates every path now", () => {
		const first = run(undefined, { "a.rs": blob("a") }, 100);
		const tree = new Map([["a.rs", blob("a")]]);
		const forced = plan(
			first.record,
			tree,
			new Map(),
			200,
			"the pull request changes migrations",
		);
		assert.equal(forced.rebuildAll, "the pull request changes migrations");
		assert.equal(forced.record.get("a.rs")?.time, 200);
		const unset = plan(first.record, tree, new Map(), 200, "");
		assert.equal(unset.rebuildAll, undefined);
		assert.equal(unset.record.get("a.rs")?.time, 100);
	});

	test("a symlink that changes, appears or goes away dates what it pointed to, before and after", () => {
		const base = {
			"a/data.txt": link("l1"),
			"a/one.txt": blob("1"),
			"a/two.txt": blob("2"),
			"skills/x/SKILL.md": blob("s"),
			"other.rs": blob("o"),
		};
		const links = { "a/data.txt": "one.txt" };
		const first = run(undefined, base, 100, links);

		const retargeted = run(
			first.record,
			{ ...base, "a/data.txt": link("l2") },
			200,
			{ "a/data.txt": "two.txt" },
		);
		assert.equal(retargeted.rebuildAll, undefined);
		assert.deepEqual(times(retargeted.record), {
			"a/data.txt": 200,
			"a/one.txt": 200,
			"a/two.txt": 200,
			"skills/x/SKILL.md": 100,
			"other.rs": 100,
		});

		const { "a/data.txt": _, ...unlinked } = base;
		assert.deepEqual(times(run(first.record, unlinked, 200).record), {
			"a/one.txt": 200,
			"a/two.txt": 100,
			"skills/x/SKILL.md": 100,
			"other.rs": 100,
		});

		const appeared = run(
			first.record,
			{ ...base, "docs/skills": link("l3") },
			200,
			{ ...links, "docs/skills": "../skills" },
		);
		assert.equal(appeared.record.get("skills/x/SKILL.md")?.time, 200);
		assert.equal(appeared.record.get("a/one.txt")?.time, 100);

		const unchanged = run(first.record, base, 200, links);
		assert.equal(unchanged.changed, 0);
		assert.equal(unchanged.record.get("a/one.txt")?.time, 100);
	});
});

describe("records", () => {
	test("round-trip paths with spaces and tabs", () => {
		const record: SourceTimes = new Map([
			["a b/c\td.rs", { signature: blob("x"), time: 123.5 }],
			["e.rs", { signature: `${link("y")} "a\\tb"`, time: 456 }],
		]);
		assert.deepEqual(parseRecord(formatRecord(record)), record);
	});

	test("read git ls-tree -z output", () => {
		const parsed = parseTree(
			"040000 tree t1\tcrates\x00100644 blob a1\tcrates/a b.rs\x00",
		);
		assert.deepEqual(Object.fromEntries(parsed), {
			crates: dir("t1"),
			"crates/a b.rs": blob("a1"),
		});
	});
});
