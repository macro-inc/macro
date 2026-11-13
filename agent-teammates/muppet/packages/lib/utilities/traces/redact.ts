/**
 * Redaction: what goes in a trace is made safe to send first. The agent's own
 * credentials are replaced wherever they appear, exactly, before any pattern
 * runs, so a pattern that matches only part of one can't leave the rest; then
 * anything shaped like a credential (private keys, GitHub, Anthropic, OpenAI,
 * Google, Slack and AWS tokens, JWTs, `Bearer`/`Basic` values, `password=`,
 * secret URL parameters, one-time codes in prose) and, in JSON, the value of
 * any secret-looking key.
 */
import type { Credentials } from "../credentials/index.ts";

/** Turns anything about to be sent into something safe to send. */
export type Redactor = {
	readonly text: (text: string) => string;
	/** A JSON value with every string in it redacted, and the values of secret-looking keys replaced. */
	readonly value: (value: unknown) => unknown;
};

const secretKey =
	/pass(word)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|otp|totp|^code$|reset|session[_-]?token/i;
/** A process's exit code is a number under `code` too, and isn't a secret. */
const exitCode = /^(exit_?)?code$/i;
/** Under `code`, a string with spaces or lines in it is program text, not a one-time code. */
const sourceCode = /\s/;
const urlKey =
	/^(?:token|code|key|secret|signature|sig|session|auth|password|access_token|refresh_token|X-Amz-[\w-]+)$/i;

/** A redactor for these exact values (those of 8 characters or more, longest first) and every pattern. */
export const redactor = (secrets: readonly string[]): Redactor => {
	const exact = [
		...new Set(secrets.filter((secret) => secret.length >= 8)),
	].sort((a, b) => b.length - a.length);
	const text = (input: string): string => {
		let result = input;
		for (const secret of exact) result = result.split(secret).join("[secret]");
		result = result.replace(
			/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g,
			"[secret]",
		);
		result = result.replace(
			/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,}|GOCSPX-[A-Za-z0-9_-]{16,}|xox[abpr]-[A-Za-z0-9-]{16,}|AKIA[A-Z0-9]{16})\b/g,
			"[secret]",
		);
		result = result.replace(
			/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
			"[secret]",
		);
		result = result.replace(/\b(Bearer|Basic)(\s+)[^\s,;]+/gi, "$1$2[secret]");
		result = result.replace(/\b(password\s*[:=]\s*)[^\s&;,]+/gi, "$1[secret]");
		// JSON written out as text, e.g. a tool's result: the value of a secret-looking key.
		result = result.replace(
			/("([\w-]+)"\s*:\s*)"(?:[^"\\]|\\.)*"/g,
			(match, head: string, key: string) =>
				secretKey.test(key) && !exitCode.test(key)
					? `${head}"[secret]"`
					: match,
		);
		result = result.replace(
			/([?&#])([\w-]+)=([^&#\s"'<>]+)/g,
			(match, mark: string, key: string) =>
				urlKey.test(key) ? `${mark}${key}=[secret]` : match,
		);
		result = result.replace(
			/\b((?:verification(?:\s+code)?|code|otp|pin|passcode)\b(?:\s+is)?[\s:=-]{1,20})([A-Za-z0-9]{4,8})\b/gi,
			(match, label: string, code: string) =>
				/\d/.test(code) ? `${label}[code]` : match,
		);
		return result;
	};
	const value = (input: unknown): unknown => {
		if (typeof input === "string") return text(input);
		if (Array.isArray(input)) return input.map(value);
		if (input === null || typeof input !== "object") return input;
		const prototype: unknown = Object.getPrototypeOf(input);
		if (prototype !== Object.prototype && prototype !== null) return input;
		return Object.fromEntries(
			Object.entries(input).map(([key, entry]) => [
				key,
				(typeof entry === "string" &&
					secretKey.test(key) &&
					!(exitCode.test(key) && sourceCode.test(entry))) ||
				(typeof entry === "number" &&
					secretKey.test(key) &&
					!exitCode.test(key))
					? "[secret]"
					: value(entry),
			]),
		);
	};
	return { text, value };
};

/** Every credential's value, for `redactor`. Read each time it is called, so a changed credential is redacted too. A credential that can't be read is left out. */
export const credentialValues =
	(credentials: Pick<Credentials, "names" | "get">) =>
	async (): Promise<readonly string[]> => {
		const names = await credentials.names();
		const values = await Promise.all(
			names.map((name) => credentials.get(name).catch(() => "")),
		);
		return values.filter((value) => value !== "");
	};
