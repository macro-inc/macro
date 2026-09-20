import { cn } from '@ui';
import type { FileChangeKind } from '../core/changeset';
import { statusLetter } from '../core/changeset';

const LABELS: Record<FileChangeKind, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
};

/** The one-letter change status, coloured like the diff it describes. */
export function StatusLetter(props: { kind: FileChangeKind; class?: string }) {
  return (
    <span
      class={cn(
        'w-3 shrink-0 text-center font-mono text-[10px] font-medium',
        props.kind === 'added' && 'text-success',
        props.kind === 'modified' && 'text-blue',
        props.kind === 'deleted' && 'text-failure',
        props.kind === 'renamed' && 'text-violet',
        props.class
      )}
      aria-label={LABELS[props.kind]}
      title={LABELS[props.kind]}
    >
      {statusLetter(props.kind)}
    </span>
  );
}
