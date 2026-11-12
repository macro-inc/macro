import { describe, expect, test } from "bun:test";
import {
	type Catalog,
	describe as docs,
	module,
	program,
	type Signatures,
	summarize,
} from "../capability.ts";
import { codeMode } from "../code.ts";

const greet = async ({ greeting }: { greeting: string }, name: string) =>
	`${greeting}, ${name}`;

const greeting = module({
	name: "greeting",
	summary: "Greets people.",
	docs: "Use it to be polite.",
	file: "/agent/greeting.ts",
	functions: { greet },
});

const ffmpeg = program({
	name: "ffmpeg",
	summary: "Converts media.",
	docs: "ffmpeg -i in out",
});

const catalog: Catalog = { greeting, ffmpeg };

const signatures: Signatures = async (file, names) =>
	`signatures of ${names.join(", ")} in ${file}`;

describe("catalog", () => {
	test("summarizes every capability in one line, a module with its functions", () => {
		expect(summarize(catalog)).toBe(
			"- greeting (module): Greets people. Functions: greet.\n- ffmpeg (program): Converts media.",
		);
	});

	test("describes a module by its docs, its import and its functions' signatures", async () => {
		expect(await docs(catalog, ["greeting"], signatures)).toBe(
			[
				"## greeting (module)\nGreets people.",
				"Use it to be polite.",
				'import { greet } from "/agent/greeting.ts";',
				"signatures of greet in /agent/greeting.ts",
			].join("\n\n"),
		);
	});

	test("describes one function of a module by its name", async () => {
		expect(await docs(catalog, ["greet"], signatures)).toBe(
			[
				"## greet (a function of greeting)\nGreets people.",
				"Use it to be polite.",
				'import { greet } from "/agent/greeting.ts";',
				"signatures of greet in /agent/greeting.ts",
			].join("\n\n"),
		);
	});

	test("describes the named capabilities, and says which don't exist", async () => {
		expect(await docs(catalog, ["ffmpeg", "nope"], signatures)).toBe(
			"## ffmpeg (program)\nConverts media.\n\nffmpeg -i in out\n\n## nope\nNo such capability.",
		);
	});
});

describe("codeMode", () => {
	test("gives the agent the catalog, docs and execute", async () => {
		const script = { file: "/agent/script.ts", name: "Script" };
		const mode = codeMode(
			catalog,
			{ greeting: "hi" },
			{
				load: async () => ({ kind: "loaded", module: { main: () => "ran" } }),
				signatures,
				script,
			},
		);
		expect(mode.catalog).toBe(summarize(catalog));
		expect(mode.script).toBe(script);
		expect(await mode.describe(["greeting"])).toContain("Greets people.");
		expect(await mode.execute("x")).toEqual({
			kind: "succeeded",
			output: "ran",
			logs: "",
		});
	});
});
