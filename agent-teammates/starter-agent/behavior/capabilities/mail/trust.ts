/**
 * Who a mail is really from, and who the agent may ever write to. Pure. Everything
 * here fails closed: an address or header it can't read plainly counts as no.
 */
import { z } from "zod";

export const Header = z.object({ name: z.string(), value: z.string() });
export type Header = z.infer<typeof Header>;

export type Address = {
	readonly address: string;
	readonly domain: string;
	readonly local: string;
	/** The display name: attacker text, never proof of anything. */
	readonly display: string;
};

const plainAddress = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const count = (text: string, piece: string): number =>
	text.split(piece).length - 1;

/** A bare address, lowercased, or undefined. No lists, no group syntax, no comments left over. */
export const parseAddress = (
	value: string | undefined,
): Address | undefined => {
	if (value === undefined || value === "") return undefined;
	// Display names are attacker text: `"owner@example.com" <evil@evil.example>` is evil.example.
	const noQuoted = value
		.replace(/"(?:[^"\\]|\\.)*"/g, '""')
		.replace(/\([^()]*\)/g, "")
		.trim();
	const opens = count(noQuoted, "<");
	if (opens > 1 || count(noQuoted, ">") !== opens) return undefined;
	const raw =
		opens === 1 ? (/<([^<>]*)>\s*$/.exec(noQuoted)?.[1] ?? "") : noQuoted;
	const address = raw.trim().toLowerCase();
	if (!plainAddress.test(address)) return undefined;
	const at = address.lastIndexOf("@");
	const display =
		opens === 1
			? value.slice(0, value.lastIndexOf("<")).replace(/["']/g, "").trim()
			: "";
	return {
		address,
		domain: address.slice(at + 1),
		local: address.slice(0, at),
		display,
	};
};

/**
 * Who the mail is read for: the agent's own mailbox, its owner's address, and
 * the domain whose verified senders count as colleagues. A public mail
 * provider's domain has no colleagues, since anyone can have an address
 * there: then only the owner's own address counts.
 */
export type Who = {
	readonly mailbox: string;
	readonly owner: string | undefined;
	readonly domain: string | undefined;
};

/** Domains anyone can sign up at, so sharing one makes nobody a colleague. */
const publicDomains = new Set([
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"live.com",
	"msn.com",
	"yahoo.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"pm.me",
	"gmx.com",
	"zoho.com",
	"fastmail.com",
	"hey.com",
	"yandex.com",
	"mail.com",
]);

/** Who, from the agent's mailbox and its owner's Macro id (`macro|name@domain`). */
export const whoOf = (mailbox: string, ownerId: string): Who => {
	const owner = parseAddress(ownerId.replace(/^macro\|/, ""));
	return {
		mailbox: mailbox.trim().toLowerCase(),
		owner: owner?.address,
		domain:
			owner === undefined || publicDomains.has(owner.domain)
				? undefined
				: owner.domain,
	};
};

/**
 * An address the agent may ever write to: the owner's own, or exactly at the
 * owner's domain (an address at a subdomain of it, or at a longer domain that starts with it, fails). Never the
 * agent's own mailbox.
 */
export const isColleagueAddress = (address: string, who: Who): boolean => {
	if (/[<>\s,]/.test(address.trim())) return false;
	const parsed = parseAddress(address);
	if (parsed === undefined || isOwnAddress(parsed.address, who)) return false;
	return parsed.address === who.owner || parsed.domain === who.domain;
};

/** Whether From claims to be a colleague: the colleague domain or under it, or the owner's address. */
export const claimsColleague = (address: Address, who: Who): boolean =>
	address.address === who.owner ||
	(who.domain !== undefined &&
		(address.domain === who.domain ||
			address.domain.endsWith(`.${who.domain}`)));

/** The agent's own mailbox, including its plus aliases. */
export const isOwnAddress = (
	address: string,
	who: Pick<Who, "mailbox">,
): boolean => {
	const parsed = parseAddress(address);
	const mine = parseAddress(who.mailbox);
	return (
		parsed !== undefined &&
		mine !== undefined &&
		parsed.domain === mine.domain &&
		parsed.local.replace(/\+.*$/, "") === mine.local
	);
};

export const headerAll = (
	headers: readonly Header[],
	name: string,
): readonly string[] =>
	headers
		.filter((header) => header.name.toLowerCase() === name.toLowerCase())
		.map(({ value }) => value);

export const header = (
	headers: readonly Header[],
	name: string,
): string | undefined => headerAll(headers, name)[0];

export type AuthResults = {
	readonly server: string;
	readonly spf: string;
	readonly dmarc: string;
	readonly dmarcFrom: string;
	readonly dkim: readonly {
		readonly result: string;
		readonly domain: string;
	}[];
};

const googleServer = "mx.google.com";

/**
 * Google's verdict: only the topmost Authentication-Results, stamped by
 * mx.google.com. Gmail prepends it on delivery, so anything below it, however
 * it's labelled, came from the sender and means nothing.
 */
export const authResults = (
	headers: readonly Header[],
): AuthResults | undefined => {
	const top = header(headers, "Authentication-Results");
	if (top === undefined || top === "") return undefined;
	const clean = top
		.replace(/\([^()]*\)/g, " ")
		.replace(/"[^"]*"/g, '""')
		.replace(/\s+/g, " ");
	const [server, ...parts] = clean.split(";").map((part) => part.trim());
	if (server !== googleServer) return undefined;
	const property = (part: string, key: string): string =>
		new RegExp(`\\b${key}=(\\S+)`, "i").exec(part)?.[1]?.toLowerCase() ?? "";
	const methods = parts.flatMap((part) => {
		const [, method, result] = /^(spf|dkim|dmarc)=(\w+)/i.exec(part) ?? [];
		return method === undefined || result === undefined
			? []
			: [
					{
						method: method.toLowerCase(),
						result: result.toLowerCase(),
						part,
					},
				];
	});
	// The last of each wins, as when they were read one by one.
	const last = (name: string) =>
		methods.findLast(({ method }) => method === name);
	const dmarc = last("dmarc");
	return {
		server,
		spf: last("spf")?.result ?? "none",
		dmarc: dmarc?.result ?? "none",
		dmarcFrom: dmarc === undefined ? "" : property(dmarc.part, "header\\.from"),
		dkim: methods
			.filter(({ method }) => method === "dkim")
			.map(({ result, part }) => ({
				result,
				domain:
					property(part, "header\\.d") ||
					property(part, "header\\.i").replace(/^.*@/, ""),
			})),
	};
};

/** The one From header's address, or undefined if there are none, several, or it can't be read. */
const onlyFrom = (headers: readonly Header[]): Address | undefined => {
	const from = headerAll(headers, "From");
	return from.length === 1 ? parseAddress(from[0]) : undefined;
};

/** The domain in From really sent it, for any vendor: DMARC passed for that exact domain. */
export const senderAuthenticated = (headers: readonly Header[]): boolean => {
	const address = onlyFrom(headers);
	const auth = authResults(headers);
	return (
		address !== undefined &&
		auth !== undefined &&
		auth.dmarc === "pass" &&
		auth.dmarcFrom === address.domain
	);
};

/**
 * A sender counts as a colleague only with one From that is a colleague's
 * address (see `isColleagueAddress`) and SPF, DKIM (signed by the sender's
 * domain) and DMARC all passing for it. SPF needn't align: a domain's own
 * bulk sender often bounces from a subdomain, and DMARC plus DKIM already
 * prove the sender.
 */
export const trustedColleague = (
	headers: readonly Header[],
	who: Who,
): { readonly ok: boolean; readonly why: string } => {
	const from = headerAll(headers, "From");
	if (from.length !== 1)
		return { ok: false, why: `${from.length} From headers` };
	const address = parseAddress(from[0]);
	if (address === undefined || !isColleagueAddress(address.address, who))
		return { ok: false, why: "From is not a colleague's address" };
	const { domain } = address;
	const auth = authResults(headers);
	if (auth === undefined)
		return { ok: false, why: "no Authentication-Results from Google" };
	if (auth.spf !== "pass") return { ok: false, why: `spf=${auth.spf}` };
	if (auth.dmarc !== "pass" || auth.dmarcFrom !== domain)
		return {
			ok: false,
			why: `dmarc=${auth.dmarc} for ${auth.dmarcFrom || "nothing"}`,
		};
	if (
		!auth.dkim.some(
			(signature) => signature.result === "pass" && signature.domain === domain,
		)
	)
		return { ok: false, why: `no passing DKIM signature from ${domain}` };
	return { ok: true, why: `spf, dkim, dmarc pass for ${domain}` };
};

const robotLocal =
	/^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|alerts?|auth|authdev|billing|support|hello|info|news|updates?|team|admin|calendar-notification)([-+._].*)?$/;

const listHeaders = [
	"List-Id",
	"List-Unsubscribe",
	"List-Post",
	"X-Autoreply",
	"X-Autorespond",
	"X-Auto-Response-Suppress",
	"X-Loop",
	"Feedback-ID",
] as const;

/** An auto-reply, no-reply address, or list: never replied to, however it's dressed up. Returns why, or undefined. */
export const automated = (headers: readonly Header[]): string | undefined => {
	const address = parseAddress(header(headers, "From"));
	if (address === undefined) return "unreadable From";
	if (robotLocal.test(address.local)) return `robot address ${address.local}@`;
	const auto = header(headers, "Auto-Submitted");
	if (auto !== undefined && auto !== "" && !/^no\b/i.test(auto.trim()))
		return "Auto-Submitted";
	if (
		/^(bulk|list|junk|auto_reply)$/i.test(
			(header(headers, "Precedence") ?? "").trim(),
		)
	)
		return "Precedence";
	const list = listHeaders.find((name) => header(headers, name) !== undefined);
	if (list !== undefined) return list;
	if ((header(headers, "Return-Path") ?? "").trim() === "<>")
		return "empty Return-Path";
	if (
		/^(auto(matic)?[- ]?(reply|response)|out of (the )?office|undeliverable|delivery status)/i.test(
			(header(headers, "Subject") ?? "").trim(),
		)
	)
		return "auto-reply subject";
	return undefined;
};
