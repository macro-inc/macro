import type { Intent, Suggestions } from './input';

/** Display the source while extraction runs; interpreting it belongs to the model. */
export function localFields(
  text: string,
  intent: Intent
): Partial<Suggestions> {
  if (intent === 'search') return { query: text };
  if (intent === 'note')
    return {
      title: text
        .split('\n')[0]
        .replace(/^#{1,6}\s+/, '')
        .trim(),
      body: text,
    };
  if (intent === 'task') return { title: text.split('\n')[0].trim() };
  if (intent === 'email' || intent === 'message') return { body: text };
  return {};
}
