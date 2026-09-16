import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';

export function transcribeDictation(
  audio: Blob,
  language: string,
  signal: AbortSignal
) {
  const hint = language.split('-')[0].toLowerCase();
  const query = /^[a-z]{2}$/.test(hint)
    ? `?language=${encodeURIComponent(hint)}`
    : '';
  return fetchWithToken<{ text: string }>(
    `${SERVER_HOSTS['document-storage-service']}/dictation/transcribe${query}`,
    {
      method: 'POST',
      body: audio,
      signal,
      headers: { 'Content-Type': audio.type },
      retry: { maxTries: 1 },
    }
  );
}
