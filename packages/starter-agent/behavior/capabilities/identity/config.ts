/** The greeting's model: quick, since the owner is watching the DM, and one Macro credits allow. */
export const greetingModel = 'claude-haiku-4-5-20251001';
/** The longest the greeting's model call may take. */
export const greetingTimeoutMs = 60_000;
const greetingFile = 'greeting.md';
/** The prompt the greeting is written from, beside this file. */
export const greetingPath = (join: (...parts: readonly string[]) => string) =>
  join(import.meta.dir, greetingFile);
/** What the ledger calls the greeting's spend. */
export const greetingSpend = 'identity.greeting';
/** What the agent has besides its capabilities: a computer of its own, when it runs on one. */
export const computer = 'computer';
/**
 * Written once the owner has been greeted. Agents from before greetings
 * wrote it when they scheduled their introduction, so they aren't greeted
 * a second time.
 */
export const greetedFile = 'introduced';
/** How many starts' greetings have failed, in the run bucket. */
export const failuresFile = 'greeting-failures';
