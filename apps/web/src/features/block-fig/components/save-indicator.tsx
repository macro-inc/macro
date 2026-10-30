import CloudArrowUp from '@icon/system/regular/cloud-arrow-up.svg';
import CloudCheck from '@icon/system/regular/cloud-check.svg';
import WarningCircle from '@icon/system/regular/warning-circle.svg';
import { match } from 'ts-pattern';
import type { SaveState } from '../primitives/create-fig-editor';

export function SaveIndicator(props: { state: SaveState }) {
  const label = () =>
    match(props.state)
      .with('saved', () => 'All changes saved')
      .with('unsaved', () => 'Unsaved changes')
      .with('saving', () => 'Saving…')
      .with('error', () => 'Save failed')
      .exhaustive();
  return (
    <span
      class="flex size-6 shrink-0 items-center justify-center text-ink-muted"
      role="status"
      aria-label={label()}
      title={label()}
      data-testid="fig-save-state"
      data-state={props.state}
    >
      {match(props.state)
        .with('saved', () => <CloudCheck class="size-3.5" />)
        .with('error', () => <WarningCircle class="size-3.5 text-failure" />)
        .otherwise(() => (
          <CloudArrowUp class="size-3.5 animate-pulse" />
        ))}
    </span>
  );
}
