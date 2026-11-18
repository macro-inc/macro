/** What went wrong, as text: an error's stack, or anything else thrown as a string. */
export const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const head = `${error.name}: ${error.message}`;
  const stack = error.stack;
  if (stack === undefined || stack === '') return head;
  // A stack doesn't always start with the message (it can be just the
  // frames), and the message is what says what went wrong.
  return stack.startsWith(head) ? stack : `${head}\n${stack}`;
};

/** What went wrong in one line, for a person: an error's message, without its stack. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
