/**
 * The only way the agent sends email. A pure gate and composer, and the thin
 * sender around them; a failure at any step means no mail. Every recipient
 * is checked, Reply-To is never followed, and a mail must prove it's from a
 * colleague: email to anyone else could be talked into by anyone who can
 * send mail.
 */
import type { Mailbox } from "./gmail.ts";
import type { Mail, RawMail } from "./message.ts";
import { oneLine, redact } from "./redact.ts";
import type { Event, Store } from "./store.ts";
import { header, isColleagueAddress, isOwnAddress, type Who } from "./trust.ts";

export const replyLimits = {
	perThreadDay: 2,
	perThreadEver: 6,
	perDay: 10,
	maxChars: 2000,
} as const;

const day = 24;

/** The line every reply ends with: whoever reads it knows an agent wrote it. */
export const disclosure = (name: string): string =>
	`${name}. I am an AI agent, not a person.`;

export type Gate =
	| { readonly ok: true; readonly to: string }
	| { readonly ok: false; readonly why: string };

export type Recipients = {
	readonly cc: readonly string[];
	readonly bcc: readonly string[];
};

/**
 * Whether the agent may reply to this mail, and to whom: always the address
 * in From, never Reply-To. Only a verified colleague; never an auto-reply, a
 * no-reply address or a list; every Cc and Bcc a colleague's address; once
 * per mail, and within the limits per thread and per day.
 */
export const gate = (
	mail: Mail,
	{ cc, bcc }: Recipients,
	past: readonly Event[],
	now: Temporal.Instant,
	who: Who,
): Gate => {
	const no = (why: string): Gate => ({ ok: false, why });
	if (mail.from === undefined) return no("unreadable From");
	if (mail.own) return no("mail from this mailbox");
	if (mail.labels.includes("SPAM") || mail.labels.includes("TRASH"))
		return no("in spam or trash");
	if (!isColleagueAddress(mail.from.address, who))
		return no(`${mail.from.address} is not a colleague: no reply, ever`);
	if (!mail.colleague)
		return no(`not verified as a colleague: ${mail.colleagueWhy}`);
	if (mail.automated !== undefined) return no(`automated: ${mail.automated}`);
	for (const address of [...cc, ...bcc]) {
		if (isOwnAddress(address, who))
			return no(`recipient ${address} is this mailbox`);
		if (!isColleagueAddress(address, who))
			return no(`recipient ${address} is not a colleague`);
	}
	const replies = past.filter(({ kind }) => kind === "reply");
	if (replies.some(({ message }) => message === mail.id))
		return no("already replied to this mail");
	const today = (event: Event) => now.since(event.at).total("hours") < day;
	const thread = replies.filter((event) => event.thread === mail.threadId);
	if (thread.length >= replyLimits.perThreadEver) return no("thread limit");
	if (thread.filter(today).length >= replyLimits.perThreadDay)
		return no("thread limit for today");
	if (replies.filter(today).length >= replyLimits.perDay)
		return no("daily limit");
	return { ok: true, to: mail.from.address };
};

/** Why this text can't be sent, or undefined. A reply can't carry a code or key out of the mailbox. */
export const bodyProblem = (body: string): string | undefined => {
	if (body.trim() === "") return "empty";
	if (body.length > replyLimits.maxChars) return "too long";
	if (redact(body) !== body)
		return "looks like it contains a code, reset link, or secret";
	return undefined;
};

/** One line: a header's value can't start another header. */
const clean = (text: string): string => text.replace(/[\r\n]+/g, " ").trim();
const base64 = (text: string): string =>
	btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const encoded = (text: string): string =>
	/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64(text)}?=`;
const messageIds = (text: string | undefined): readonly string[] =>
	(text ?? "").match(/<[^<>\s]+>/g) ?? [];

const referencesKept = 10;

export const compose = (
	mail: Mail,
	{
		to,
		cc,
		bcc,
		body,
	}: Recipients & { readonly to: string; readonly body: string },
	sender: { readonly name: string; readonly mailbox: string },
): string => {
	const subject = clean(mail.subject);
	const [id] = messageIds(header(mail.headers, "Message-ID"));
	const references = [
		...messageIds(header(mail.headers, "References")),
		...(id === undefined ? [] : [id]),
	].slice(-referencesKept);
	return [
		`From: ${encoded(clean(sender.name))} <${sender.mailbox}>`,
		`To: ${to}`,
		...(cc.length > 0 ? [`Cc: ${cc.join(", ")}`] : []),
		...(bcc.length > 0 ? [`Bcc: ${bcc.join(", ")}`] : []),
		`Subject: ${encoded(/^re:/i.test(subject) ? subject : `Re: ${subject}`)}`,
		...(id === undefined ? [] : [`In-Reply-To: ${id}`]),
		...(references.length > 0 ? [`References: ${references.join(" ")}`] : []),
		// Their auto-responders stay quiet, and our own gate would refuse a bounce back.
		"Auto-Submitted: auto-replied",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
		"",
		base64(`${body.trim()}\n\n${disclosure(clean(sender.name))}\n`),
	].join("\r\n");
};

export type ReplyRequest = Recipients & {
	readonly id: string;
	readonly text: string;
	/** Check everything and send nothing. */
	readonly dryRun: boolean;
};

export type Replied =
	| { readonly kind: "replied"; readonly to: string }
	| { readonly kind: "would-reply"; readonly to: string }
	| { readonly kind: "refused"; readonly why: string };

const whyChars = 200;

/**
 * The one send path. It holds the only `send` there is: nothing else in the
 * agent is given a mailbox that can send.
 */
export const replier =
	({
		box,
		who,
		name,
		parse,
		store,
		locked,
		log,
		now,
	}: {
		readonly box: Pick<Mailbox, "get" | "send">;
		readonly who: Who;
		/** The name the agent signs with. */
		readonly name: string;
		readonly parse: (raw: RawMail) => Mail;
		readonly store: Pick<Store, "events" | "addEvent">;
		/** Runs one reply at a time, across processes: two can't both pass the limits. */
		readonly locked: <Result>(work: () => Promise<Result>) => Promise<Result>;
		/** Mail's log. */
		readonly log: (entry: object) => Promise<void>;
		readonly now: () => Temporal.Instant;
	}) =>
	({ id, text, cc, bcc, dryRun }: ReplyRequest): Promise<Replied> =>
		locked(async () => {
			const refuse = async (why: string): Promise<Replied> => {
				await log({ event: "reply-refused", id, why: oneLine(why, whyChars) });
				return { kind: "refused", why };
			};
			// Fresh from Gmail, not the local copy: the gate reads Google's own stamps.
			const raw = await box.get(id);
			if (raw === undefined) return refuse(`no mail ${id}`);
			const mail = parse(raw);
			const allowed = gate(mail, { cc, bcc }, await store.events(), now(), who);
			if (!allowed.ok) return refuse(allowed.why);
			const problem = bodyProblem(text);
			if (problem !== undefined) return refuse(problem);
			if (dryRun) return { kind: "would-reply", to: allowed.to };
			// Counted first: a crash can't send twice.
			await store.addEvent({
				at: now(),
				kind: "reply",
				thread: mail.threadId,
				message: id,
			});
			const sent = await box.send(
				compose(
					mail,
					{ to: allowed.to, cc, bcc, body: text },
					{ name, mailbox: who.mailbox },
				),
				mail.threadId,
			);
			await log({
				event: "reply",
				id,
				to_domain: mail.from?.domain,
				chars: text.length,
				sent: sent.id,
			});
			return { kind: "replied", to: allowed.to };
		});
