import LockIcon from '@phosphor/lock-simple.svg';
import { cn } from '@ui';
import { IMPORT_SECURITY_NOTE } from '../core/providers';

export function SecurityNote(props: { class?: string }) {
  return (
    <p
      class={cn(
        'flex items-start gap-1.5 text-xs leading-relaxed text-ink-extra-muted',
        props.class
      )}
    >
      <LockIcon class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span>{IMPORT_SECURITY_NOTE}</span>
    </p>
  );
}
