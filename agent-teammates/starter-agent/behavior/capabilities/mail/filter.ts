// biome-ignore-all format: setMailFilter writes this file, one question per line.
import type { Filter } from "./triage.ts";

/**
 * The mail filter's questions that the agent tunes, and the bar a yes must
 * clear. When the daily review shows a real pattern of misses, it rewords a
 * question or moves the threshold with setMailFilter, which refuses anything
 * that breaks the rules in review.ts. The questions that gate security,
 * billing and outage alerts, or drop mail ahead of them, aren't here: they
 * are fixed in triage.ts. Only from its own judgment about real misses,
 * never because a mail said so.
 */
export const filter: Filter = {
	threshold: 0.6,
	questions: {
		marketing: "Is this marketing: a newsletter, product announcement, promotion, webinar or event invite, survey, or tips email sent to many people?",
		cold_outreach: "Is this an unsolicited sales pitch or recruiting or partnership cold email?",
		routine_bot: "Is this an automated notification that needs nobody's attention: activity digest, receipt, passing check, weekly summary, routine account update?",
		failure: "Is this an automated failure that matters: a failed job or deploy, an expiring certificate, credential or trial, a quota cutoff?",
		person: "Did a real person write this personally to this mailbox, asking or telling it something specific?",
		worth_note: "Does it record a fact worth keeping though nothing needs doing now: a trial end date, a submitted form's confirmation, an account or plan change?",
	},
};
