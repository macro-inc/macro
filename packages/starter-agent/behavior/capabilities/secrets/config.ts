/** The secrets area's settings: names, intervals and limits, in one place. */

/** The owner of the area's state directories. */
export const owner = 'secrets';

/** Access requests still waiting on the owner, in the run bucket. */
export const pendingFile = 'pending.json';

/** The last version of each item the agent saw, so an update can say which one it changes. */
export const versionsFile = 'versions.json';

/** The log stream every vault call is recorded in: opaque ids and outcomes, never names or values. */
export const logStream = 'secrets';

/** The schedule that asks the vault about pending requests while there are any. */
export const pollSchedule = 'secrets-access';
export const pollEvery = '5m';

/** The variable the running agent sets in a script's process: the wake it runs in. */
export const wakeVariable = 'MUPPET_WAKE_ID';

/** How long a copied value stays on the clipboard, and how many pastes it serves. */
export const clipboard = { seconds: 20, pastes: 1, readTimeoutMs: 5_000 };

/** A busy vault is asked again this many times, waiting this long the first time and doubling. */
export const busy = { retries: 3, firstWaitMs: 250 };

/** What a search returns by default, and at most (the vault's own bounds). */
export const searchLimit = { default: 50, most: 100 };
