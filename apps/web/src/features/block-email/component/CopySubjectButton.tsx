import { toast } from '@core/component/Toast/Toast';
import { CopyButton } from '@ui';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';
import { isPlaceholderSubject } from '../util/subjectText';

function copyableSubject(title: string): string | undefined {
  const subject = title.trim();
  if (!subject || isPlaceholderSubject(subject)) return undefined;
  return subject;
}

export function CopySubjectButton(props: { subject: string; class?: string }) {
  const subject = () => copyableSubject(props.subject);

  return (
    <Show when={subject()}>
      {(value) => (
        <CopyButton
          text={value()}
          label="Copy subject"
          noTouchResize
          class={cn('align-middle text-inherit', props.class)}
          onClick={(e) => e.stopPropagation()}
          onCopied={(ok) => {
            if (ok) toast.success('Subject copied');
          }}
        />
      )}
    </Show>
  );
}
