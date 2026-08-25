import { toast } from '@core/component/Toast/Toast';
import WideCopy from '@icon/wide-copy.svg';
import IconCheck from '@phosphor/check.svg';
import { debounce } from '@solid-primitives/scheduled';
import { cn, Tooltip } from '@ui';
import { createSignal, Show } from 'solid-js';
import { isPlaceholderSubject } from '../util/subjectText';

function copyableSubject(title: string): string | undefined {
  const subject = title.trim();
  if (!subject || isPlaceholderSubject(subject)) return undefined;
  return subject;
}

export function CopySubjectButton(props: { subject: string; class?: string }) {
  const [copied, setCopied] = createSignal(false);
  const resetCopied = debounce(() => setCopied(false), 800);

  function handleCopy(e: MouseEvent) {
    e.stopPropagation();
    const subject = copyableSubject(props.subject);
    if (!subject) return;
    navigator.clipboard.writeText(subject);
    toast.success('Subject copied');
    setCopied(true);
    resetCopied();
  }

  return (
    <Show when={copyableSubject(props.subject)}>
      <Tooltip label="Copy subject" as="span">
        <button
          type="button"
          aria-label="Copy subject"
          class={cn(
            'inline-flex align-middle size-6 items-center justify-center rounded-md text-ink-muted hover:bg-ink/5 hover:text-ink',
            props.class
          )}
          onClick={handleCopy}
        >
          <Show when={copied()} fallback={<WideCopy class="size-3.5" />}>
            <IconCheck class="size-3.5" />
          </Show>
        </button>
      </Tooltip>
    </Show>
  );
}
