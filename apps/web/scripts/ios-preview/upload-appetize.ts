#!/usr/bin/env bun
/**
 * Zip an iOS Simulator .app and publish it to Appetize for a PR.
 *
 * The PR keeps one Appetize app across pushes: the public key is recovered from
 * the preview comment, so a rebuild replaces the binary behind the existing
 * link instead of minting a new one. `--cleanup` deletes the app on PR close.
 *
 * Usage:
 *   bun scripts/ios-preview/upload-appetize.ts \
 *     --archive ../../artifacts/macro-sim.zip \
 *     --pr 123 --repo owner/repo --token $GITHUB_TOKEN --note "abc1234"
 *   bun scripts/ios-preview/upload-appetize.ts --pr 123 --repo owner/repo \
 *     --token $GITHUB_TOKEN --cleanup
 *
 * Environment:
 *   APPETIZE_API_TOKEN  required
 *
 * Output: prints the Appetize public key to stdout.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractPublicKeyFromBody, findIosPreviewComment } from './appetize';
import { fetchIssueComments } from './github';

const APPETIZE_API = 'https://api.appetize.io/v1/apps';

/**
 * Streaming is what Appetize bills, so both limits exist to stop a forgotten
 * browser tab costing money.
 *
 * `timeout` frees the device after this long with no interaction — the common
 * case, someone wandering off mid-review. Only the values in Appetize's enum
 * are accepted (30/60/90/120/180/300/600/1800/3600/7200); 180 is short enough
 * that an abandoned tab stops quickly and long enough to read a screen. Booting
 * again is one click.
 *
 * `timeLimit` is the backstop `timeout` cannot provide: a page that keeps
 * poking the session stays "active" indefinitely, so cap the session outright.
 * Unlike `timeout` it takes any number of seconds.
 */
const SESSION_INACTIVITY_TIMEOUT_SECONDS = '180';
const SESSION_HARD_LIMIT_SECONDS = '1800';

/** One reviewer at a time per PR; a preview is not a shared demo environment. */
const MAX_CONCURRENT_SESSIONS = '2';

interface Args {
  /** Zipped .app produced by `build_ios_simulator_app.sh`. */
  archive?: string;
  pr: number;
  repo: string;
  token: string;
  note: string;
  cleanup: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Partial<Args> = { cleanup: false, note: '' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--archive' && args[i + 1]) {
      result.archive = args[i + 1];
      i++;
    }
    if (args[i] === '--pr' && args[i + 1]) {
      result.pr = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === '--repo' && args[i + 1]) {
      result.repo = args[i + 1];
      i++;
    }
    if (args[i] === '--token' && args[i + 1]) {
      result.token = args[i + 1];
      i++;
    }
    if (args[i] === '--note' && args[i + 1]) {
      result.note = args[i + 1];
      i++;
    }
    if (args[i] === '--cleanup') {
      result.cleanup = true;
    }
  }

  if (!result.pr || !result.repo || !result.token) {
    console.error('Missing required arguments: --pr, --repo, --token');
    process.exit(1);
  }
  if (!(result.cleanup || result.archive)) {
    console.error('--archive is required unless --cleanup is passed');
    process.exit(1);
  }

  return result as Args;
}

function apiToken(): string {
  const token = process.env.APPETIZE_API_TOKEN;
  if (!token) {
    console.error('APPETIZE_API_TOKEN is not set');
    process.exit(1);
  }
  return token;
}

async function findExistingPublicKey(args: Args): Promise<string | null> {
  const comments = await fetchIssueComments(args.repo, args.pr, args.token);
  const comment = findIosPreviewComment(comments);
  return comment?.body ? extractPublicKeyFromBody(comment.body) : null;
}

async function publish(args: Args, publicKey: string | null): Promise<string> {
  const archive = resolve(args.archive as string);
  if (!existsSync(archive)) {
    console.error(`No archive at ${archive}`);
    process.exit(1);
  }

  const form = new FormData();
  form.set('file', new Blob([await Bun.file(archive).arrayBuffer()]), 'app.zip');
  form.set('platform', 'ios');
  form.set('fileType', 'zip');
  form.set('timeout', SESSION_INACTIVITY_TIMEOUT_SECONDS);
  form.set('timeLimit', SESSION_HARD_LIMIT_SECONDS);
  form.set('maxConcurrent', MAX_CONCURRENT_SESSIONS);
  form.set('note', args.note);
  // A leaked link cannot drain the account, and the embed is only reachable
  // from a PR page.
  form.set('appPermissions.run', 'authenticated');
  form.set('referrerHostnamesRestricted', 'github.com');

  const url = publicKey ? `${APPETIZE_API}/${publicKey}` : APPETIZE_API;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-KEY': apiToken() },
    body: form,
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(`Appetize upload failed (${response.status}): ${text}`);
    process.exit(1);
  }

  const parsed: unknown = JSON.parse(text);
  const key =
    typeof parsed === 'object' && parsed !== null && 'publicKey' in parsed
      ? String((parsed as { publicKey: unknown }).publicKey)
      : null;
  if (!key) {
    console.error(`Appetize response carried no publicKey: ${text}`);
    process.exit(1);
  }
  return key;
}

async function cleanup(publicKey: string): Promise<void> {
  const response = await fetch(`${APPETIZE_API}/${publicKey}`, {
    method: 'DELETE',
    headers: { 'X-API-KEY': apiToken() },
  });
  // A 404 means someone already removed it; that is the desired end state.
  if (!(response.ok || response.status === 404)) {
    console.error(
      `Appetize delete failed (${response.status}): ${await response.text()}`
    );
    process.exit(1);
  }
  console.error(`Deleted Appetize app ${publicKey}`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const existingKey = await findExistingPublicKey(args);

  if (args.cleanup) {
    if (existingKey) await cleanup(existingKey);
    else console.error('No Appetize app recorded on this PR; nothing to clean');
    return;
  }

  const publicKey = await publish(args, existingKey);
  console.error(
    existingKey
      ? `Updated Appetize app ${publicKey}`
      : `Created Appetize app ${publicKey}`
  );
  console.log(publicKey);
}

if (import.meta.main) {
  main();
}
