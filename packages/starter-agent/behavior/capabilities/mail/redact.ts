/**
 * Codes, reset links, and secrets out of anything that leaves the mailbox:
 * logs, notes, DMs, the local store, and every model. Overshooting is fine;
 * the mail itself is still in Gmail for a signup that really needs the code.
 */
const linkSecret =
  /(token|code|reset|verif|confirm|magic|otp|sign-?in|log-?in|auth|key|invite|session|unsubscribe|password)/i;

const keys: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bGOCSPX-[A-Za-z0-9_-]{10,}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
];

/** Every link in a text. */
export const links = /https?:\/\/[^\s<>"')\]]+/gi;

const hasDigit = (text: string): boolean => /\d/.test(text);

const redactLink = (url: string): string => {
  if (!URL.canParse(url))
    return linkSecret.test(url) || /[A-Za-z0-9_-]{20,}/.test(url)
      ? '[link to link redacted]'
      : url;
  const { host, pathname, search, hash } = new URL(url);
  const rest = pathname + search + hash;
  return linkSecret.test(rest) || /[A-Za-z0-9_-]{20,}/.test(rest)
    ? `[link to ${host} redacted]`
    : url;
};

export const redact = (text: string): string => {
  const withoutKeys = keys.reduce(
    (current, key) => current.replace(key, '[secret redacted]'),
    text.replace(links, redactLink)
  );
  return (
    withoutKeys
      .replace(
        /\b(password|passcode|passwd|pwd)(\s*(?:is|:|=)\s*)\S+/gi,
        '$1$2[redacted]'
      )
      // "your code is 8K2M-Q", "verification code: ABC123", "OTP 4411".
      .replace(
        /\b(code|otp|pin|passcode|token|verification|verify)\b([^\n]{0,40})/gi,
        (_, word: string, after: string) =>
          `${word}${after.replace(
            /\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g,
            (value) =>
              hasDigit(value) && value.length >= 4 && value.length <= 16
                ? '[code redacted]'
                : value
          )}`
      )
      // Bare codes: "Log into Macro - 153060", "G-482913", "ABC-123".
      .replace(/\b\d{6,8}\b/g, '[code redacted]')
      .replace(/\b[A-Z]{1,4}-\d{4,8}\b/g, '[code redacted]')
      .replace(/\b\d{3,4}[- ]\d{3,4}\b(?!\s*[-–]\s*\d)/g, (match) =>
        /^\d{4}[- ]\d{4}$/.test(match) || /^\d{3}[- ]\d{3}$/.test(match)
          ? '[code redacted]'
          : match
      )
  );
};

/** Control characters, and the ones that reorder text, which could spoof a log line. */
const control = /[\u0000-\u001f\u007f‪-‮⁦-⁩]+/g;

/** Text with control characters out, cut short: safe on one line in a log or DM. */
export const oneLine = (text: string, max = 80): string =>
  redact(text).replace(control, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
