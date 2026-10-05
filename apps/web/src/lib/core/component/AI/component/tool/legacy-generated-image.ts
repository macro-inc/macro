import { z } from 'zod/v3';

const legacyImageResponse = z.object({
  documentId: z.string().min(1),
  fileName: z.string().min(1),
  note: z.string().nullish(),
});

/** Validate historical image results before selecting their document renderer. */
export function parseLegacyGeneratedImage(name: string, response: unknown) {
  if (name !== 'GenerateImage') return;
  const parsed = legacyImageResponse.safeParse(response);
  return parsed.success ? parsed.data : undefined;
}
