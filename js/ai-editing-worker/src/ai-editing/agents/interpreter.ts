import { generateText, type LanguageModel, stepCountIs, type Tool } from 'ai';
import { EDIT_PROVIDER_OPTIONS } from './model-options';

export async function interpreter(
  documentContext: string,
  request: string,
  model: LanguageModel,
  system: string,
  tools?: Record<string, Tool>
) {
  const prompt = `User request: ${request}\n\n${documentContext}`;

  const result = await generateText({
    model,
    system,
    prompt,
    providerOptions: EDIT_PROVIDER_OPTIONS,
    ...(tools ? { tools, stopWhen: stepCountIs(12) } : {}),
  });

  return { text: result.text, totalUsage: result.totalUsage };
}
