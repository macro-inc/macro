import { type LanguageModel, type Tool, generateText, stepCountIs } from 'ai';

export async function interpret(
  documentContext: string,
  request: string,
  model: LanguageModel,
  system: string,
  tools?: Record<string, Tool>
) {
  const prompt = `User request: ${request}\n\n${documentContext}`;

  return generateText({
    model,
    system,
    prompt,
    ...(tools ? { tools, stopWhen: stepCountIs(12) } : {}),
  });
}
