// The local stack's stand-in for the model (`crates/model_emulator`): a test
// says ahead of time what the model answers, and no model is ever called.
//
// A script answers the conversation whose message names it with
// `[[script:<name>]]`. The stand-in is shared by every test on the stack, so
// a test names its script after itself (`scriptName`).

import { randomBytes } from 'node:crypto';
import { sendJson } from './http';

/** A tool call of the model. */
export type ModelCall = { name: string; args: Record<string, unknown> };

/** One turn of the model: what it says, the tools it calls, or both. */
export type ModelReply = { text?: string; calls?: ModelCall[] };

/** The model's side of one conversation. */
export type ModelScript = {
  /** The model's turns, in order; each later one answers the tools' results. */
  replies: ModelReply[];
  /**
   * Values the replies take from the request: a regular expression with one
   * group each, whose last match in the request's text replaces `{{<name>}}`.
   */
  captures?: Record<string, string>;
};

/** A request the stand-in was sent, as it read it. */
export type ModelRequest = {
  model: string;
  script: string | null;
  reply: number | null;
  body: Record<string, unknown>;
};

function modelUrl(): string {
  const url = process.env.EMAIL_E2E_STACK_MODEL_URL;
  if (!url) {
    throw new Error(
      'EMAIL_E2E_STACK_MODEL_URL is not set: the stack runs its model stand-in only when it has no real Gemini key (also none in the environment it was started from)'
    );
  }
  return url.replace(/\/$/, '');
}

/** A script name no other test uses. */
export function scriptName(what: string): string {
  return `${what}-${randomBytes(6).toString('hex')}`;
}

/** What a message carries to be answered by the script. */
export function scriptMarker(name: string): string {
  return `[[script:${name}]]`;
}

/** Tells the stand-in what to answer the conversation that names `name`. */
export async function scriptModel(
  name: string,
  script: ModelScript
): Promise<void> {
  await sendJson(`${modelUrl()}/_emulator/scripts/${name}`, {
    method: 'PUT',
    body: script,
  });
}

/** The requests the stand-in answered from the script `name`, oldest first. */
export async function modelRequests(name: string): Promise<ModelRequest[]> {
  return sendJson<ModelRequest[]>(
    `${modelUrl()}/_emulator/requests?script=${name}`
  );
}
