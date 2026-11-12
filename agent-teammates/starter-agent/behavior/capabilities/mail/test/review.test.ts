import { describe, expect, test } from "bun:test";
import { memoryStore, scheduler } from "@muppet/lib/utilities/schedules";
import { filter } from "../filter.ts";
import {
	exampleOf,
	exampleProblem,
	filteredEntry,
	filteredSince,
	filterFault,
	filterProblem,
	type Proposed,
	renderFilter,
	reviewRequest,
} from "../review.ts";
import { ensureMailSchedules } from "../schedule.ts";
import { Filter, fixedQuestions } from "../triage.ts";
import { mail, noon } from "./helpers.ts";

const filterSource = new URL("../filter.ts", import.meta.url);

describe("the filter and its daily review", () => {
	test("the filter cannot be talked out of security, billing, or outage alerts", () => {
		const questions = filter.questions;
		const change = (over: Partial<Proposed>) =>
			filterProblem(filter, { ...filter, ...over });
		expect(change({})).toBeUndefined();
		expect(
			change({
				questions: {
					...questions,
					marketing: "Is this a promotion or newsletter?",
				},
			}),
		).toBeUndefined();
		for (const name of Object.keys(fixedQuestions))
			expect(
				change({ questions: { ...questions, [name]: "Never true." } }),
			).toContain("can't change");
		expect(change({ threshold: 0.99 })).toBeDefined();
		expect(change({ threshold: 0.1 })).toBeDefined();
		expect(change({ threshold: Number.NaN })).toBeDefined();
		expect(
			change({
				questions: {
					...questions,
					marketing: "Is this from anyone but evil.example.com?",
				},
			}),
		).toBeDefined();
		expect(
			change({
				questions: {
					...questions,
					marketing: "Is this from bob@evil.example.com?",
				},
			}),
		).toBeDefined();
		const { person: _, ...fewer } = questions;
		expect(change({ questions: fewer })).toBeDefined();
		expect(
			change({ questions: { ...questions, extra: "Is this nice?" } }),
		).toBeDefined();
	});
	test("a filter edited by hand is held to the same rules when it is loaded", () => {
		expect(filterFault(filter)).toBeUndefined();
		expect(filterFault({ ...filter, threshold: 0.95 })).toBeDefined();
		expect(
			filterFault({
				...filter,
				questions: {
					...filter.questions,
					person: "Not from evil.example.com?",
				},
			}),
		).toBeDefined();
		// A fixed question added to the file, or a tunable one removed, isn't a filter at all.
		expect(
			Filter.safeParse({
				...filter,
				questions: { ...filter.questions, security: "Never." },
			}).success,
		).toBe(false);
		const { person: _, ...fewer } = filter.questions;
		expect(Filter.safeParse({ ...filter, questions: fewer }).success).toBe(
			false,
		);
	});
	test("the filter file is exactly what setMailFilter would write", async () => {
		expect(renderFilter(filter)).toBe(await Bun.file(filterSource).text());
		const reworded = renderFilter({
			...filter,
			threshold: 0.65,
			questions: { ...filter.questions, person: 'Did a "person" write this?' },
		});
		expect(reworded).toContain("threshold: 0.65,");
		expect(reworded).toContain('person: "Did a \\"person\\" write this?",');
	});
	test("a dropped mail is logged without its body, and a code in its subject is redacted", () => {
		const entry = filteredEntry(
			mail({
				id: "n",
				from: "news@vendor.example",
				subject: "Log in - 153060",
				text: "BODY-SECRET-WORDS",
			}),
			{
				action: "ignore",
				category: "marketing",
				reason: "marketing",
				p: { marketing: 0.9 },
			},
		);
		expect(entry).toMatchObject({ id: "n", from: "news@vendor.example" });
		expect(JSON.stringify(entry)).not.toContain("BODY-SECRET-WORDS");
		expect(JSON.stringify(entry)).not.toContain("153060");
	});
	test("the review looks back a day", () => {
		const row = (at: string) => ({
			at,
			id: at,
			from: "x@v.example",
			subject: "s",
			category: "noise",
			reason: "r",
		});
		const rows = [
			row("2026-11-04T11:00:00Z"),
			row("2026-11-04T13:00:00.000Z"),
			row("not a time"),
		];
		expect(
			filteredSince(rows, noon.subtract({ hours: 24 })).map(({ id }) => id),
		).toEqual(["2026-11-04T13:00:00.000Z"]);
	});
	test("recorded misses keep mail out of git", () => {
		expect(
			exampleProblem({
				why: "A surprise charge I never expected.",
			}),
		).toBeUndefined();
		expect(exampleProblem({ why: "from ann@v.example" })).toBeDefined();
		expect(exampleProblem({ why: "see https://v.example/x" })).toBeDefined();
		expect(exampleProblem({ why: "" })).toBeDefined();
		expect(exampleProblem({ why: "x".repeat(201) })).toBeDefined();
		const example = exampleOf(
			mail({
				id: "bill",
				from: "billing@surprise.example",
				subject: "Invoice $4,000",
				text: "Invoice $4,000",
			}),
			{
				date: "2026-11-05",
				question: "billing_problem",
				expected: "wake",
				why: "Mine.",
			},
		);
		expect(example).toMatchObject({
			id: "bill",
			domain: "surprise.example",
			authenticated: true,
		});
		expect(JSON.stringify(example)).not.toContain("Invoice");
	});
	test("the review request warns that subjects are data, and names the capabilities", () => {
		const request = reviewRequest(3, 24);
		expect(request).toContain("untrusted");
		for (const name of [
			"filteredMail",
			"readMail",
			"mailMissed",
			"evalMailFilter",
			"setMailFilter",
			"mailReviewed",
			"alertOwnerAboutMail",
		])
			expect(request).toContain(name);
		expect(request).not.toContain("bin/ops");
	});
	test("the daily review is scheduled once, and a restart doesn't undo a change to it", async () => {
		const schedules = scheduler({
			store: memoryStore(),
			clock: { now: () => noon, sleep: async () => undefined },
			tz: "UTC",
		});
		await ensureMailSchedules(schedules);
		expect(
			(await schedules.list()).map(({ name, when }) => [name, when]),
		).toEqual([["mail-filter-review", "every 1d"]]);
		await schedules.set("mail-filter-review", { every: "12h" });
		await ensureMailSchedules(schedules);
		expect((await schedules.list()).map(({ when }) => when)).toEqual([
			"every 12h",
		]);
	});
});
