/**
 * Macro CLA signing worker.
 *
 * Routes:
 *   GET /cla           – the CLA text with a "Sign with GitHub" link
 *                        (?signed=1 renders the post-signature confirmation)
 *   GET /cla/callback  – GitHub OAuth callback; records the signature
 *   GET /cla/check     – bearer-gated lookup for the enforcement Action
 *
 * Cron: weekly full-table JSON dump to R2.
 *
 * Design constraints (see the spec / README): no sessions, no framework, no
 * client JS. Signatures are keyed on GitHub's immutable numeric user ID and
 * versioned against the CLA text; the store is append-only. The OAuth token
 * is requested with zero scopes, used for exactly one API call, and never
 * stored. Every failure mode resolves to "not signed".
 */

// Bundled as a text module (see `rules` in wrangler.jsonc) so the served text
// and CLA_VERSION deploy atomically and can never drift.
import claMarkdown from "../CLA.md";

export interface Env {
  DB: D1Database;
  EXPORTS: R2Bucket;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  CHECK_API_KEY: string;
  CLA_VERSION: string;
}

const STATE_COOKIE = "cla_oauth_state";
/// Signing must complete within this window or the state cookie expires.
const STATE_COOKIE_MAX_AGE_SECONDS = 600;

const RECEIPT_COOKIE = "cla_receipt";
/// How long the confirmation page stays viewable after signing. Short: it is
/// a receipt for the person who just signed, not a durable record — the D1
/// row is the record.
const RECEIPT_COOKIE_MAX_AGE_SECONDS = 600;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/cla":
        return claPage(request, url, env);
      case "/cla/callback":
        return callback(request, url, env);
      case "/cla/check":
        return check(request, url, env);
      default:
        return new Response("not found", { status: 404 });
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await exportSignatures(env);
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// GET /cla

async function claPage(request: Request, url: URL, env: Env): Promise<Response> {
  // Post-callback redirect target: refreshing this page never replays the
  // OAuth code exchange. The receipt cookie — not the query string — is what
  // authorizes the confirmation, so `?signed=1` alone renders nothing; an
  // absent or invalid receipt just falls through to the agreement.
  if (url.searchParams.get("signed") === "1") {
    const receipt = await readReceipt(env, readCookie(request, RECEIPT_COOKIE));
    if (receipt) {
      return confirmationPage(receipt, env);
    }
  }

  const nonce = randomHex(16);
  const signature = await hmacHex(env.GITHUB_CLIENT_SECRET, nonce);
  const authorizeUrl =
    "https://github.com/login/oauth/authorize" +
    `?client_id=${encodeURIComponent(env.GITHUB_CLIENT_ID)}` +
    `&state=${nonce}`;

  const body = pageShell(
    "Macro Contributor License Agreement",
    `${renderMarkdown(claMarkdown)}
     <div class="sign">
       <a class="button" href="${escapeHtml(authorizeUrl)}" rel="nofollow">Sign with GitHub</a>
       <p class="fine">Signing in with GitHub records your agreement to version
       ${escapeHtml(env.CLA_VERSION)} of this document against your GitHub
       account's numeric user ID, along with the time of signing and the IP
       address the signature was submitted from. We request no OAuth scopes —
       only your public GitHub identity.</p>
     </div>`,
  );

  return htmlResponse(body, 200, {
    // Standard CSRF handling: the nonce round-trips through GitHub as
    // `state` and must match this HMAC-signed, short-lived cookie.
    "Set-Cookie":
      `${STATE_COOKIE}=${nonce}.${signature}; Max-Age=${STATE_COOKIE_MAX_AGE_SECONDS}; ` +
      "Path=/cla; Secure; HttpOnly; SameSite=Lax",
  });
}

function confirmationPage(receipt: Receipt, env: Env): Response {
  // Display-only echo of what the callback just wrote; the D1 row is the
  // record.
  const who = ` as <strong>@${escapeHtml(receipt.login)}</strong>`;
  const when = receipt.signed_at
    ? ` on <strong>${escapeHtml(receipt.signed_at)}</strong>`
    : "";
  const body = pageShell(
    "CLA signed",
    `<h1>Signed &#10003;</h1>
     <p>You signed version <strong>${escapeHtml(env.CLA_VERSION)}</strong> of the
     Macro Contributor License Agreement${who}${when}. This covers all your
     future contributions — no need to sign again.</p>
     <p>If a pull request of yours has a red <code>cla</code> check, comment
     <code>@macro-bot check</code> on it and the check will re-run.</p>
     <p><a href="/cla">View the agreement</a></p>`,
  );
  return htmlResponse(body, 200);
}

// ---------------------------------------------------------------------------
// GET /cla/callback

async function callback(request: Request, url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return errorPage("Missing OAuth parameters.", 400);
  }

  const cookie = readCookie(request, STATE_COOKIE);
  if (!cookie || !(await verifyState(env, cookie, state))) {
    return errorPage("State verification failed. Your signing session may have expired.", 403);
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  if (!tokenResponse.ok) {
    return errorPage("GitHub rejected the sign-in code exchange.", 502);
  }
  const token = ((await tokenResponse.json()) as { access_token?: string }).access_token;
  if (!token) {
    return errorPage("GitHub did not return an access token.", 502);
  }

  // The token's only use. It is never stored.
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "macro-cla-worker",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!userResponse.ok) {
    return errorPage("Could not read your GitHub identity.", 502);
  }
  const user = (await userResponse.json()) as { id: number; login: string };
  if (typeof user.id !== "number" || typeof user.login !== "string") {
    return errorPage("GitHub returned an unexpected identity payload.", 502);
  }

  // INSERT OR IGNORE makes re-signing the same version idempotent: the
  // original row (and its signed_at) stands.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO signatures (github_id, github_login, cla_version, signed_at, ip) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(
      user.id,
      user.login,
      env.CLA_VERSION,
      new Date().toISOString(),
      request.headers.get("CF-Connecting-IP"),
    )
    .run();

  const row = await env.DB.prepare(
    "SELECT signed_at FROM signatures WHERE github_id = ?1 AND cla_version = ?2",
  )
    .bind(user.id, env.CLA_VERSION)
    .first<{ signed_at: string }>();

  const confirmation = new URL("/cla", url.origin);
  confirmation.searchParams.set("signed", "1");

  const headers = new Headers({ Location: confirmation.toString() });
  headers.append(
    "Set-Cookie",
    `${STATE_COOKIE}=; Max-Age=0; Path=/cla; Secure; HttpOnly; SameSite=Lax`,
  );
  headers.append(
    "Set-Cookie",
    `${RECEIPT_COOKIE}=${await issueReceipt(env, {
      login: user.login,
      signed_at: row?.signed_at ?? "",
    })}; Max-Age=${RECEIPT_COOKIE_MAX_AGE_SECONDS}; ` +
      "Path=/cla; Secure; HttpOnly; SameSite=Lax",
  );
  return new Response(null, { status: 302, headers });
}

/// What the confirmation page displays back to the signer.
interface Receipt {
  login: string;
  signed_at: string;
}

/// Mint an HMAC-signed confirmation receipt. Without this the confirmation
/// page would render from query parameters, letting anyone craft a URL that
/// claims any account signed. Enforcement never reads this — it reads D1 —
/// but a receipt people screenshot should not be forgeable.
async function issueReceipt(env: Env, receipt: Receipt): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify(receipt));
  return `${payload}.${await hmacHex(env.GITHUB_CLIENT_SECRET, payload)}`;
}

/// Verify and decode a receipt cookie. Any tampering, truncation, or garbage
/// resolves to `null`, which renders the agreement instead of a confirmation.
async function readReceipt(env: Env, cookie: string | null): Promise<Receipt | null> {
  if (!cookie) {
    return null;
  }
  const separator = cookie.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const payload = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);
  const expected = await hmacHex(env.GITHUB_CLIENT_SECRET, payload);
  if (!(await timingSafeEqualStrings(signature, expected))) {
    return null;
  }
  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Partial<Receipt>;
    if (typeof parsed.login !== "string" || typeof parsed.signed_at !== "string") {
      return null;
    }
    return { login: parsed.login, signed_at: parsed.signed_at };
  } catch {
    return null;
  }
}

async function verifyState(env: Env, cookie: string, state: string): Promise<boolean> {
  const separator = cookie.lastIndexOf(".");
  if (separator <= 0) {
    return false;
  }
  const nonce = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);
  const expected = await hmacHex(env.GITHUB_CLIENT_SECRET, nonce);
  return (await timingSafeEqualStrings(signature, expected)) && (await timingSafeEqualStrings(state, nonce));
}

// ---------------------------------------------------------------------------
// GET /cla/check

async function check(request: Request, url: URL, env: Env): Promise<Response> {
  const authorization = request.headers.get("Authorization") ?? "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!presented || !(await timingSafeEqualStrings(presented, env.CHECK_API_KEY))) {
    return new Response("unauthorized", { status: 401 });
  }

  const githubId = url.searchParams.get("github_id") ?? "";
  if (!/^\d+$/.test(githubId)) {
    return new Response("github_id must be a numeric GitHub user id", { status: 400 });
  }

  // Strict versioning policy: only current-version rows pass. If a CLA bump
  // decides to grandfather earlier versions (or a CCLA `ccla:<company>` tag),
  // widen this to a `cla_version IN (...)` allowlist — that decision is made
  // at bump time, never implicitly.
  const row = await env.DB.prepare(
    "SELECT cla_version FROM signatures WHERE github_id = ?1 AND cla_version = ?2",
  )
    .bind(Number(githubId), env.CLA_VERSION)
    .first<{ cla_version: string }>();

  return Response.json(
    row ? { signed: true, version: row.cla_version } : { signed: false, version: null },
  );
}

// ---------------------------------------------------------------------------
// Weekly R2 export

async function exportSignatures(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT github_id, github_login, cla_version, signed_at, ip FROM signatures ORDER BY signed_at",
  ).all();
  const day = new Date().toISOString().slice(0, 10);
  await env.EXPORTS.put(`cla-signatures/${day}.json`, JSON.stringify(results, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Crypto helpers

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return hex(buffer);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return hex(new Uint8Array(signature));
}

/// Constant-time string comparison. Hashing both sides first equalizes the
/// lengths `timingSafeEqual` requires without leaking length information.
async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(digestA, digestB);
}

// Receipt payloads are ASCII by construction (GitHub logins and ISO
// timestamps), so btoa/atob are safe here.
function base64UrlEncode(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(text: string): string {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

function hex(buffer: Uint8Array): string {
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering. A deliberately tiny markdown subset (headings, paragraphs,
// lists, hr, bold, code, links) — enough for CLA.md, which we author. Input
// is HTML-escaped before any markup is applied.

function renderMarkdown(markdown: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const closeParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();
    const heading = /^(#{1,6}) +(.*)$/.exec(line);
    const bullet = /^[-*] +(.*)$/.exec(line);
    const numbered = /^\d+\. +(.*)$/.exec(line);

    if (line === "") {
      closeParagraph();
      closeList();
    } else if (/^-{3,}$/.test(line)) {
      closeParagraph();
      closeList();
      out.push("<hr>");
    } else if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      closeParagraph();
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inlineMarkdown((bullet ?? numbered)![1])}</li>`);
    } else if (list) {
      // Hard-wrapped continuation of the previous list item.
      const last = out.pop()!;
      out.push(last.replace(/<\/li>$/, ` ${inlineMarkdown(line.trim())}</li>`));
    } else {
      paragraph.push(line);
    }
  }
  closeParagraph();
  closeList();
  return out.join("\n");
}

function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" rel="noopener noreferrer">$1</a>',
    );
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// The Macro M mark (apps/web/src/components/icon/macro-logo.svg), inlined so
// the page stays a single self-contained response.
const LOGO_SVG = `<svg width="34" height="34" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M0 10.014v6.801a.75.75 0 0 0 .225.513l2.742 2.644 2.002-.8v-7.099l-2.97-2.859z"/>
  <path d="M4.078 4.8v5.786l1.36 1.309v1.313L12.481 20l2.002-.8-.001-7.1L6.078 4z"/>
  <path d="M13.594 4.8v5.786l1.36 1.311-.013 1.3L22 20 24 19.2V12.42a.75.75 0 0 0-.225-.533L15.595 4z"/>
</svg>`;

// The app's favicon (apps/web/public/macro-favicon.svg) in white, inlined as
// a data URI so the worker serves a single self-contained page.
const FAVICON_DATA_URI =
  "data:image/svg+xml," +
  "%3Csvg width='100%25' height='100%25' fill='%23ffffff' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E" +
  "%3Cpath d='m6.25 4.038-2.242 0.8792v5.8184l-1.756-1.6582-2.242 0.8792v6.6766c0 0.2568 0.106 0.502 0.292 0.6784l2.794 2.6422 2.244-0.879v-5.8184l7.084 6.6974 2.244-0.879v-5.8184l7.086 6.6976 2.24-0.8792v-6.6766c0-0.2568-0.104-0.5022-0.292-0.6784l-8.124-7.6816-2.244 0.879v5.8184z'/%3E" +
  "%3C/svg%3E";

function pageShell(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
         line-height: 1.6; color: #c9c9cc; background: #1a1a1c; margin: 0; }
  main { max-width: 44rem; margin: 0 auto; padding: 3rem 1.5rem 5rem; }
  .logo { color: #fff; margin-bottom: 1.4rem; }
  h1, h2, strong { color: #f4f4f5; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 2.2rem; }
  a { color: #f4f4f5; }
  ul { padding-left: 1.3rem; }
  li { margin: 0.35rem 0; }
  code { background: #2a2a2e; color: #e7e7ea; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
  hr { border: none; border-top: 1px solid #2b2b2e; margin: 2.2rem 0; }
  .sign { margin-top: 2.8rem; text-align: center; }
  .button { display: inline-block; background: #f4f4f5; color: #1a1a1c; text-decoration: none;
            padding: 0.7rem 1.6rem; border-radius: 6px; font-weight: 600; }
  .button:hover { background: #fff; }
  .fine { color: #8b8b90; font-size: 0.85rem; max-width: 34rem; margin: 1.1rem auto 0; }
</style>
</head>
<body>
<main>
<div class="logo">${LOGO_SVG}</div>
${content}
</main>
</body>
</html>`;
}

function htmlResponse(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

function errorPage(message: string, status: number): Response {
  return htmlResponse(
    pageShell(
      "CLA signing failed",
      `<h1>Something went wrong</h1>
       <p>${escapeHtml(message)}</p>
       <p><a href="/cla">Try again</a></p>`,
    ),
    status,
  );
}
