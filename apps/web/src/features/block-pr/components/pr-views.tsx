import { Tabs } from '@ui';
import { type JSX, Show } from 'solid-js';

export type PrView = 'overview' | 'diff';

/** Only mount the selected view, so opening a PR does not fetch its diff. */
export function PrViews(props: {
  view: PrView;
  onViewChange: (view: PrView) => void;
  overview: JSX.Element;
  diff: JSX.Element;
}) {
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex shrink-0 items-center border-b border-edge-muted px-3 py-2">
        <Tabs
          aria-label="Pull request view"
          value={props.view}
          onChange={(value) =>
            props.onViewChange(value === 'diff' ? 'diff' : 'overview')
          }
          list={[
            { value: 'overview', label: 'Overview' },
            { value: 'diff', label: 'Diff' },
          ]}
        />
      </div>
      <div
        role="region"
        aria-label={`Pull request ${props.view}`}
        class="flex min-h-0 flex-1 flex-col"
      >
        <Show when={props.view === 'diff'} fallback={props.overview}>
          {props.diff}
        </Show>
      </div>
    </div>
  );
}
