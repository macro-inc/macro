import { generateText, type LanguageModel } from 'ai';
import SNIPPET from '../prompts/SNIPPET.md';
import { EDIT_PROVIDER_OPTIONS } from './model-options';

/** Compose one snippet of prose from a brief; the raw text is the result. */
export async function snippet(
  brief: string,
  documentContext: string,
  model: LanguageModel,
  signal?: AbortSignal
) {
  const result = await generateText({
    model,
    system: SNIPPET,
    prompt: `Brief: ${brief}\n\nRegion of the document your text will be inserted into:\n<document>\n${documentContext}\n</document>`,
    providerOptions: EDIT_PROVIDER_OPTIONS,
    abortSignal: signal,
  });
  return { text: result.text, totalUsage: result.totalUsage };
}
