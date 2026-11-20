/**
 * What went wrong, as text: an error's stack, with its name and message at
 * the head even when the stack lacks them, or anything else thrown as a
 * string.
 */
export const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  // `Error: message`, or just `Error` when the message is empty.
  const head = String(error);
  // Anything may sit in `stack`: only a non-empty string is a stack.
  const stack: unknown = error.stack;
  if (typeof stack !== 'string' || stack === '') return head;
  // A stack doesn't always start with the message (it can be just the
  // frames), and the message is what says what went wrong.
  return stack.startsWith(head) ? stack : `${head}\n${stack}`;
};

/** What went wrong in one line, for a person: an error's message, without its stack. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
