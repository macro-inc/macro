import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { isMobile } from '@core/mobile/isMobile';
import { Tabs } from '@ui';
import { createSignal, type JSX, onMount, Show } from 'solid-js';

export function CallRecordingSidePanel(props: {
  transcript: JSX.Element;
  details: JSX.Element;
}) {
  const panel = useSidePanel();
  const [tab, setTab] = createSignal<'transcript' | 'details'>('transcript');
  onMount(() =>
    panel?.setOpenSectionIds([
      'sharing',
      'properties',
      'activity',
      'references',
    ])
  );
  return (
    <div class="flex h-full min-h-0 flex-col">
      <Show when={!isMobile()}>
        <div class="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
          <Tabs
            aria-label="Call side panel"
            variant="pills"
            size="sm"
            options={[
              { value: 'transcript', label: 'Transcript' },
              { value: 'details', label: 'Details' },
            ]}
            value={tab()}
            onChange={setTab}
          />
          <Show when={!panel?.isOverlayMode()}>
            <SidePanel.Toggle />
          </Show>
        </div>
      </Show>
      <Show
        when={isMobile() || tab() === 'details'}
        fallback={<div class="min-h-0 flex-1">{props.transcript}</div>}
      >
        <div class="min-h-0 flex-1">{props.details}</div>
      </Show>
    </div>
  );
}
