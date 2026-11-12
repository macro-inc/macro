import { describe, expect, test } from "bun:test";
import { classify, defineOutcomes, unclassified } from "../outcome.ts";
import type { OutcomeOf } from "../index.ts";
import type { Effect } from "../record.ts";

const outcomes = defineOutcomes<"pr_opened" | "issue_filed">()({
	fixed_pr_opened: {
		description: "Opened a PR that fixes it.",
		evidence: ["pr_opened"],
	},
	filed_issue: { description: "Filed an issue.", evidence: ["issue_filed"] },
	no_repro: { description: "Could not reproduce it." },
	skipped: { description: "Nothing to do." },
});

describe("defineOutcomes", () => {
	test("keeps the names as a closed set, so a report outside it doesn't compile", () => {
		const names: readonly OutcomeOf<typeof outcomes>[] = [
			"fixed_pr_opened",
			"filed_issue",
			"no_repro",
			"skipped",
			// @ts-expect-error not a declared outcome
			"fixed_everything",
		];
		expect(names).toHaveLength(5);
		// @ts-expect-error a system may not declare unclassified itself
		defineOutcomes()({ unclassified: { description: "no" } });
	});
});

describe("classify", () => {
	test("a report whose evidence was observed is confirmed", () => {
		expect(
			classify(outcomes, {
				reported: { outcome: "fixed_pr_opened", summary: "PR 12" },
				effects: [{ kind: "pr_opened", id: "12" }],
			}),
		).toEqual({
			name: "fixed_pr_opened",
			source: "reported",
			check: "confirmed",
			reported: "fixed_pr_opened",
			observed: "fixed_pr_opened",
			summary: "PR 12",
		});
	});

	test("a report that needs no evidence stands, unverifiable", () => {
		expect(
			classify(outcomes, { reported: { outcome: "no_repro" }, effects: [] }),
		).toEqual({
			name: "no_repro",
			source: "reported",
			check: "unverifiable",
			reported: "no_repro",
		});
	});

	test("a report whose evidence is missing is contradicted, and unclassified", () => {
		expect(
			classify(outcomes, {
				reported: { outcome: "fixed_pr_opened" },
				effects: [],
			}),
		).toEqual({
			name: unclassified,
			source: "none",
			check: "contradicted",
			reported: "fixed_pr_opened",
		});
	});

	test("effects win over a report they contradict", () => {
		expect(
			classify(outcomes, {
				reported: { outcome: "no_repro" },
				effects: [{ kind: "issue_filed", id: "7" }],
			}),
		).toEqual({
			name: "filed_issue",
			source: "observed",
			check: "contradicted",
			reported: "no_repro",
			observed: "filed_issue",
		});
	});

	test("without a report, effects classify the wake", () => {
		expect(classify(outcomes, { effects: [{ kind: "issue_filed" }] })).toEqual({
			name: "filed_issue",
			source: "observed",
			check: "not_reported",
			observed: "filed_issue",
		});
	});

	test("without a report or effects, the wake is unclassified", () => {
		expect(classify(outcomes, { effects: [] })).toEqual({
			name: unclassified,
			source: "none",
			check: "not_reported",
		});
	});

	test("with effects for two outcomes, the reported one stands; unreported, the first declared", () => {
		const effects: readonly Effect<"pr_opened" | "issue_filed">[] = [
			{ kind: "issue_filed" },
			{ kind: "pr_opened" },
		];
		expect(
			classify(outcomes, { reported: { outcome: "filed_issue" }, effects })
				.name,
		).toBe("filed_issue");
		expect(classify(outcomes, { effects }).name).toBe("fixed_pr_opened");
	});
});
