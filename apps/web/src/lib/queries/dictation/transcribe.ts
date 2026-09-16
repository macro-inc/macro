import { transcribeDictation } from '@service-storage/dictation';

/** One-shot mutation. Recordings and transcripts must not enter query caches. */
export async function transcribeAudio(
  audio: Blob,
  language: string,
  signal: AbortSignal
) {
  const result = await transcribeDictation(audio, language, signal);
  if (result.isErr())
    throw new Error(
      'Transcription failed. Select the checkmark to retry, or cancel.'
    );
  return result.value.text;
}
