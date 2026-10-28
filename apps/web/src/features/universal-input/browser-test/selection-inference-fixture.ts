import { type Intent, intents } from '../core/input';

/** Recognizes the fixture's sample passages without reaching the service. */
function shapeOf(text: string): Intent {
  const lower = text.toLowerCase();
  if (lower.includes('?')) return 'ai';
  if (lower.includes('tomorrow') || lower.includes('8am')) return 'calendar';
  if (lower.startsWith('ship ')) return 'task';
  return 'note';
}

export function createInferenceSource() {
  const delay = Number(
    new URLSearchParams(window.location.search).get('classify-delay') ?? 10
  );
  return {
    async classify(text: string, revision: number) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const shape = shapeOf(text);
      return {
        revision,
        scores: intents.map((intent) => ({
          intent,
          score: intent === shape ? 0.93 : 0.04,
        })),
      };
    },
    extract: () => Promise.reject(new Error('extraction is not classified')),
    dispose: () => {},
  };
}
