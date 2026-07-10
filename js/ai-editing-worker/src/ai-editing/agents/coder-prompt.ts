export function buildPrompt(
  task: string,
  context: string,
  request?: string
): string {
  const requestBlock = request
    ? `The user's request, for tone, intent, and any exact text it supplies — your assigned task below is your ONLY scope:\n<user_request>\n${request}\n</user_request>\n\n`
    : '';
  const contextBlock = `\n\nRelevant region of the document:\n<document>\n${context}\n</document>`;
  return `${requestBlock}Carry out this edit task in full:\n<task>\n${task}\n</task>${contextBlock}`;
}
