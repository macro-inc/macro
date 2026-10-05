import { isPlaceholderSubject } from '@app/features/email-compose/core/subject-text';
import CopyIcon from '@phosphor/copy.svg';
import { CopyButton } from '@ui';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';

function copyableSubject(title: string): string | undefined {
  const subject = title.trim();
  if (!subject || isPlaceholderSubject(subject)) return undefined;
  return subject;
}

export function CopySubjectButton(props: {
  subject: string;
  class?: string;
  onCopy?: (subject: string) => void | boolean | Promise<void | boolean>;
}) {
  function handleCopy(e: MouseEvent) {
    e.stopPropagation();
    const subject = copyableSubject(props.subject);
    if (!subject) return false;
    return props.onCopy?.(subject);
  }

  return (
    <Show when={props.onCopy && copyableSubject(props.subject)}>
      <CopyButton
        variant="ghost"
        size="icon-sm"
        noTouchResize
        aria-label="Copy subject"
        class={cn('align-middle text-inherit', props.class)}
        onClick={handleCopy}
      >
        <CopyIcon class="size-3.5" />
      </CopyButton>
    </Show>
  );
}
