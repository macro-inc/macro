import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import { useCodexStatusQuery } from '../auth/codex';
import { useCursorApiKeyStatusQuery } from '../auth/cursor-api-key';
import { queryReadyGate } from '../gate';

/** Connection status for a named harness; unsupported providers stay disconnected. */
export function useHarnessConnectionStatus(
  harness: Accessor<string>
): Accessor<boolean> {
  const cursor = useCursorApiKeyStatusQuery(() => harness() === 'cursor');
  const codex = useCodexStatusQuery(() => harness() === 'codex-cloud');

  return () =>
    match(harness())
      .with('cursor', () => queryReadyGate(cursor) && cursor.data.registered)
      .with(
        'codex-cloud',
        () =>
          queryReadyGate(codex) &&
          codex.data.connected &&
          !!codex.data.environmentId?.trim()
      )
      .otherwise(() => false);
}
