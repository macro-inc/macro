import { dcsCompletion } from '@service-cognition/client';

export async function generateTitle(text: string): Promise<string | undefined> {
  const result = await dcsCompletion({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `Generate a concise and informative title that describes the following text. A title should never be longer than 4 words. Respond with only the title, nothing else.\n\n${text}`,
      },
    ],
    max_tokens: 100,
  });

  if (result.isErr()) {
    console.error('Error generating title');
    return undefined;
  }

  return result.value.choices[0]?.message?.content?.trim() || undefined;
}
