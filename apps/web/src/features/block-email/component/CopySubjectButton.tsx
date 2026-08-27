import { CopyButton, cn } from '@ui';
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
          class={cn('align-middle text-inherit', props.class)}
          label="Copy subject"
          successLabel="Subject copied"
          failureLabel="Failed to copy subject"
          text={value()}
        />
      )}
    </Show>
  );
}
