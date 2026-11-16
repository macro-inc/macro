/** What went wrong, as text: an error's stack, or anything else thrown as a string. */
export const describeError = (error: unknown): string =>
	error instanceof Error ? (error.stack ?? error.message) : String(error);

/** What went wrong in one line, for a person: an error's message, without its stack. */
export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
