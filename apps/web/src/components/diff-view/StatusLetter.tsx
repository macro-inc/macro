import { cn } from '@ui';
import { type DiffFileKind, statusLetter } from './model/diff-file';

const LABELS: Record<DiffFileKind, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
};

/** The one-letter change status, coloured like the diff it describes. */
export function StatusLetter(props: { kind: DiffFileKind; class?: string }) {
  return (
    <span
      class={cn(
        'w-3 shrink-0 text-center text-xs font-medium',
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
