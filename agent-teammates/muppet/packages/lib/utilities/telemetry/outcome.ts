/**
 * What came of a wake, decided without asking a model.
 *
 * A system declares a closed set of outcomes, in order of precedence. An
 * outcome may name its evidence: the kinds of effect, any one of which shows
 * it happened (a PR opened, an issue filed, a job rerun). Two things are
 * known when a wake ends: what the agent reported through `reportOutcome`
 * (one of the declared names, or nothing), and the effects the system saw
 * for itself. The rule, in order:
 *
 * 1. The agent reported an outcome whose evidence was seen: that outcome,
 *    `confirmed`.
 * 2. The effects are evidence of some outcome (the first declared, if of
 *    several): that outcome, from `observed`. The check is `not_reported` if
 *    the agent said nothing, and `contradicted` if it reported another one:
 *    effects are facts, and a report is a claim.
 * 3. The agent reported an outcome that declares no evidence, and no effect
 *    says otherwise: that outcome, `unverifiable`.
 * 4. Otherwise `unclassified`: nothing was reported (`not_reported`), or what
 *    was reported needs evidence that never appeared (`contradicted`).
 *
 * How the wake ended (ok, failed, timeout) is recorded beside the outcome
 * and never changes it: a wake that opened its PR and then ran out of budget
 * still opened its PR. What the agent reported is always kept, in
 * `reported`.
 */
import type { Classified, Effect } from "./record.ts";

/** A system's outcomes by name, in order of precedence. */
export type Outcomes<Outcome extends string, Kind extends string> = {
	readonly [Name in Outcome]: {
		/** One line telling the agent when this is the outcome to report. */
		readonly description: string;
		/** The kinds of effect that show it happened, any one of them. Without it, the agent's word is all there is. */
		readonly evidence?: readonly Kind[];
	};
};

/** What a wake that can't be classified is recorded as. No system may declare it. */
export const unclassified = "unclassified";

/**
 * Declares a system's outcomes, held to its kinds of effect:
 *
 *     defineOutcomes<"pr_opened" | "issue_filed">()({
 *       fixed_pr_opened: { description: "…", evidence: ["pr_opened"] },
 *       no_repro: { description: "…" },
 *     })
 */
export const defineOutcomes =
	<Kind extends string = never>() =>
	<
		const Declared extends Readonly<
			Record<
				string,
				{
					readonly description: string;
					readonly evidence?: readonly Kind[];
				}
			>
		>,
	>(
		outcomes: Declared & { readonly [unclassified]?: never },
	): Outcomes<keyof Declared & string, Kind> =>
		outcomes;

/** What the agent reported: a declared outcome, and its one line on what it did. */
export type Reported<Outcome extends string> = {
	readonly outcome: Outcome;
	readonly summary?: string;
};

/** Whether `name` is one of the declared outcomes. */
export const declared = <Outcome extends string, Kind extends string>(
	outcomes: Outcomes<Outcome, Kind>,
	name: string,
): name is Outcome => Object.hasOwn(outcomes, name);

/** The rule above. */
export const classify = <Outcome extends string, Kind extends string>(
	outcomes: Outcomes<Outcome, Kind>,
	{
		reported,
		effects,
	}: {
		readonly reported?: Reported<Outcome>;
		readonly effects: readonly Effect<Kind>[];
	},
): Classified => {
	const seen = new Set<string>(effects.map((effect) => effect.kind));
	const shown = (name: Outcome): boolean =>
		(outcomes[name].evidence ?? []).some((kind) => seen.has(kind));
	const observed = Object.keys(outcomes)
		.flatMap((name) => (declared(outcomes, name) ? [name] : []))
		.find(shown);
	const said =
		reported === undefined
			? {}
			: {
					reported: reported.outcome,
					...(reported.summary === undefined
						? {}
						: { summary: reported.summary }),
				};
	const saw = observed === undefined ? {} : { observed };

	if (reported !== undefined && shown(reported.outcome))
		return {
			name: reported.outcome,
			source: "reported",
			check: "confirmed",
			...said,
			observed: reported.outcome,
		};
	if (observed !== undefined)
		return {
			name: observed,
			source: "observed",
			check: reported === undefined ? "not_reported" : "contradicted",
			...said,
			...saw,
		};
	if (
		reported !== undefined &&
		(outcomes[reported.outcome].evidence ?? []).length === 0
	)
		return {
			name: reported.outcome,
			source: "reported",
			check: "unverifiable",
			...said,
		};
	return {
		name: unclassified,
		source: "none",
		check: reported === undefined ? "not_reported" : "contradicted",
		...said,
	};
};
