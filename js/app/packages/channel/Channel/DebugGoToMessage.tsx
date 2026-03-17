import { Button } from '@ui/components/Button';
import { createSignal } from 'solid-js';

type DebugGoToMessageProps = {
  onSubmit: (messageId: string) => void;
};

export function parseDebugTargetInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'targetMessageId' in parsed
      ) {
        const targetMessageId = parsed.targetMessageId;
        if (typeof targetMessageId === 'string' && targetMessageId.trim()) {
          return targetMessageId.trim();
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  return trimmed;
}

export function DebugGoToMessage(props: DebugGoToMessageProps) {
  const [messageId, setMessageId] = createSignal('');
  const [isOpen, setIsOpen] = createSignal(true);

  const submit = () => {
    const targetMessageId = parseDebugTargetInput(messageId());
    if (!targetMessageId) return;
    props.onSubmit(targetMessageId);
  };

  return (
    <div class="pointer-events-none absolute right-4 top-4 z-20 flex items-start justify-end">
      <div class="pointer-events-auto flex items-start gap-2">
        <Button
          size="sm"
          variant="secondary"
          class="shrink-0 shadow-md"
          onClick={() => setIsOpen((open) => !open)}
        >
          {isOpen() ? 'Hide Debug' : 'Show Debug'}
        </Button>
        <div
          classList={{
            hidden: !isOpen(),
          }}
          class="w-[min(24rem,calc(100vw-5rem))] rounded-md border border-edge-muted bg-panel/95 p-3 shadow-lg backdrop-blur-sm"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Channel Debug
              </div>
              <div class="mt-1 text-xs text-ink-extra-muted">
                Paste
                {' '}
                <code>{'{"targetMessageId":"..."}'}</code>
                {' '}
                or a raw top-level message id
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              class="shrink-0"
              onClick={() => setIsOpen(false)}
            >
              Close
            </Button>
          </div>

          <div class="mt-3 flex flex-col gap-2">
            <label
              class="text-xs font-medium uppercase tracking-wide text-ink-muted"
              for="channel-debug-target-message-id"
            >
              Target Payload
            </label>
            <input
              id="channel-debug-target-message-id"
              value={messageId()}
              placeholder='Paste {"targetMessageId":"..."} or a message id'
              class="min-w-0 rounded-sm border border-edge-muted bg-page px-2 py-1.5 text-sm text-ink outline-hidden focus:border-accent"
              onInput={(event) => setMessageId(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                submit();
              }}
            />
            <div class="flex justify-end">
              <Button size="sm" variant="secondary" onClick={submit}>
                Trigger
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
