import { behavior } from "../../core/behavior.ts";
import { source } from "../../core/event.ts";

export type Mail = {
	readonly from: string;
	readonly subject: string;
	/** ISO 8601 */
	readonly receivedAt: string;
};

// A stand-in for a real inbox, which would connect to a mail server.
async function* inbox(): AsyncIterable<Mail> {
	yield {
		from: "boss@example.com",
		subject: "Production is down",
		receivedAt: "2026-11-09T09:30:00Z",
	};
	yield {
		from: "boss@example.com",
		subject: "Production is down again",
		receivedAt: "2026-11-09T11:00:00Z",
	};
	yield {
		from: "news@example.com",
		subject: "Weekly digest",
		receivedAt: "2026-11-10T08:00:00Z",
	};
}

export const sources = behavior().source({ workMail: source(inbox()) });
