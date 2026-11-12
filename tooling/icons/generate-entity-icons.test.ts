import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { committedIconNames, validateCatalog } from "./generate-entity-icons";

const icons = new Map([
	["star", '<svg data-macro-icon="star"><path d="M1 2L3 4"/></svg>'],
	["lightbulb", '<svg data-macro-icon="lightbulb"><circle r="3"/></svg>'],
]);
const sections = [
	{ id: "work", label: "Work", icons: [{ name: "star", label: "Star" }] },
];

describe("permanent entity icon catalog", () => {
	it("keeps retired drawings valid without offering them", () => {
		const catalog = validateCatalog(icons, ["star", "lightbulb"], {}, sections);
		expect(catalog.names).toEqual(["lightbulb", "star"]);
		expect([...catalog.selected]).toEqual(["star"]);
	});

	it("rejects deleting a permanent name without an alias", () => {
		expect(() => validateCatalog(icons, ["retired"], {}, sections)).toThrow(
			"Permanent icon removed without an alias: retired",
		);
	});

	it("keeps alias names valid without offering them", () => {
		const catalog = validateCatalog(
			icons,
			["retired"],
			{ retired: "star" },
			sections,
		);
		expect(catalog.names).toContain("retired");
		expect(catalog.selected.has("retired")).toBe(false);
	});

	it("rejects missing alias targets and alias chains", () => {
		expect(() =>
			validateCatalog(icons, [], { retired: "missing" }, sections),
		).toThrow("Alias target is not an icon");
		expect(() =>
			validateCatalog(icons, [], { old: "retired", retired: "star" }, sections),
		).toThrow("Alias target is not an icon");
	});

	it("rejects aliases that shadow drawings or enter the picker", () => {
		expect(() =>
			validateCatalog(icons, [], { star: "lightbulb" }, sections),
		).toThrow("Alias shadows an icon");
		expect(() =>
			validateCatalog(icons, [], { retired: "star" }, [
				{
					id: "work",
					label: "Work",
					icons: [{ name: "retired", label: "Retired" }],
				},
			]),
		).toThrow("Unknown picker icon");
	});

	it("rejects identical geometry despite whitespace and icon metadata", () => {
		const duplicates = new Map([
			["star", '<svg data-macro-icon="star"><path d="M1 2L3 4"/></svg>'],
			[
				"copy",
				'<svg xmlns = "http://www.w3.org/2000/svg" aria-label = "Copy" role = "img"\n data-macro-icon = "copy">\n  <path  d="M1 2L3 4" />\n</svg>',
			],
		]);
		expect(() => validateCatalog(duplicates, [], {}, sections)).toThrow(
			"Identical icon geometry: star, copy",
		);
	});

	it("rejects unknown and repeated section entries", () => {
		expect(() =>
			validateCatalog(icons, [], {}, [
				{
					id: "work",
					label: "Work",
					icons: [{ name: "unknown", label: "Unknown" }],
				},
			]),
		).toThrow("Unknown picker icon");
		expect(() =>
			validateCatalog(icons, [], {}, [
				...sections,
				{
					id: "other",
					label: "Other",
					icons: [{ name: "star", label: "Star" }],
				},
			]),
		).toThrow("Icon belongs to multiple sections");
	});

	it("rejects duplicate sections and unsafe filenames", () => {
		expect(() =>
			validateCatalog(icons, [], {}, [...sections, ...sections]),
		).toThrow("Invalid or duplicate section");
		expect(() =>
			validateCatalog(new Map([["../star", "<svg/>"]]), [], {}, []),
		).toThrow("Invalid icon name");
	});

	it("retains committed names through manifest moves, trimming, and discarded merge changes", async () => {
		const root = await mkdtemp(join(tmpdir(), "entity-icons-history-"));
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: root, stdio: "pipe" });
		try {
			git("init", "-q");
			git("config", "user.name", "Test");
			git("config", "user.email", "user@example.com");
			await mkdir(join(root, "tooling/icons"), { recursive: true });
			const path = join(root, "tooling/icons/entity-icon-names.json");
			await writeFile(path, JSON.stringify(["retired", "star"]));
			git("add", ".");
			git("commit", "-qm", "seed catalog");
			await writeFile(path, JSON.stringify(["star"]));
			git("add", ".");
			git("commit", "-qm", "trim manifest");
			const permanent = committedIconNames(root);
			expect(() => validateCatalog(icons, permanent, {}, sections)).toThrow(
				"Permanent icon removed without an alias: retired",
			);
			expect(
				validateCatalog(icons, permanent, { retired: "lightbulb" }, sections)
					.names,
			).toContain("retired");
			git("checkout", "-qb", "catalog-addition");
			await writeFile(path, JSON.stringify(["star", "branch-only"]));
			git("add", ".");
			git("commit", "-qm", "add icon");
			git("checkout", "-");
			git(
				"merge",
				"-s",
				"ours",
				"--no-ff",
				"-m",
				"merge catalog",
				"catalog-addition",
			);
			expect(committedIconNames(root)).toContain("branch-only");
			await mkdir(join(root, "packages/entity-icons"), { recursive: true });
			const movedPath = join(root, "packages/entity-icons/names.json");
			git("mv", path, movedPath);
			git("commit", "-qm", "move catalog");
			expect(committedIconNames(root)).toEqual(
				expect.arrayContaining(["star", "retired", "branch-only"]),
			);
			await writeFile(movedPath, JSON.stringify(["star", "new-catalog-icon"]));
			git("add", ".");
			git("commit", "-qm", "extend moved catalog");
			await writeFile(movedPath, JSON.stringify(["star"]));
			git("add", ".");
			git("commit", "-qm", "trim moved catalog");
			expect(committedIconNames(root)).toEqual(
				expect.arrayContaining([
					"star",
					"retired",
					"branch-only",
					"new-catalog-icon",
				]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
