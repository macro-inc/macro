/**
 * Replaces the composer of a legacy AI chat once agent sessions have taken
 * over. The transcript stays readable; this says why nothing can be sent and
 * points at the replacement.
 */

import { runCreateAction } from '@app/features/command/Launcher';
import { LEGACY_CHAT_DEPRECATION_NOTICE } from '@entity/components/Badges';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { Button } from '@ui';

export function DeprecatedChatBanner() {
  return (
    <div
      role="status"
      class="flex w-full items-center gap-3 rounded-lg border border-edge-muted bg-surface-2 px-3 py-2 text-xs text-ink-muted"
    >
      <WarningCircleIcon class="size-4 shrink-0 text-warning" />
      <span class="min-w-0 flex-1">
        <span class="font-medium text-ink">This AI chat is deprecated.</span>{' '}
        {LEGACY_CHAT_DEPRECATION_NOTICE}
      </span>
      <Button
        variant="outline"
        size="sm"
        class="shrink-0"
        onClick={() =>
          runCreateAction('agent', { source: 'deprecated_chat_banner' })
        }
      >
        New agent session
      </Button>
    </div>
  );
}
