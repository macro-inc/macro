import { toast } from '@core/component/Toast/Toast';
import { CopyButton, cn } from '@ui';
import { Show } from 'solid-js';
import { isPlaceholderSubject } from '../util/subjectText';

function copyableSubject(title: string): string | undefined {
  const subject = title.trim();
  if (!subject || isPlaceholderSubject(subject)) return undefined;
  return subject;
}

export function CopySubjectButton(props: { subject: string; class?: string }) {
  return (
    <Show when={copyableSubject(props.subject)}>
      {(subject) => (
        <CopyButton
          aria-label="Copy subject"
          class={cn('align-middle text-inherit', props.class)}
          text={subject()}
          onCopied={() => toast.success('Subject copied')}
          onCopyError={() => toast.failure('Failed to copy subject')}
        />
      )}
    </Show>
  );
}
