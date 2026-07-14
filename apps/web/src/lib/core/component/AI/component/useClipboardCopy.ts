import { createSignal } from 'solid-js';

export function useClipboardCopy() {
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(
        () => setCopiedKey((current) => (current === key ? null : current)),
        2000
      );
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  return { copiedKey, copy };
}
