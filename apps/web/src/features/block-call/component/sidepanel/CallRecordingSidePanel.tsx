import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { isMobile } from '@core/mobile/isMobile';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, Tabs } from '@ui';
import { createSignal, type JSX, onMount, Show } from 'solid-js';

export function CallRecordingSidePanel(props: {
  transcript: JSX.Element;
  details: JSX.Element;
  footer?: JSX.Element;
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
        fallback={
          <>
            <div class="min-h-0 flex-1">{props.transcript}</div>
            <Show when={props.footer}>
              <div class="shrink-0 p-3">{props.footer}</div>
            </Show>
          </>
        }
      >
        <div class="min-h-0 flex-1">{props.details}</div>
      </Show>
    </div>
  );
}

export function CallDetailsSheetHeader() {
  const panel = useSidePanel();
  return (
    <Show when={isMobile()}>
      <div class="flex shrink-0 items-center justify-between px-5 pb-2">
        <h2 class="text-lg font-semibold">Details</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close details"
          onClick={() => panel?.setIsOpen(false)}
        >
          <CloseIcon class="size-5" />
        </Button>
      </div>
    </Show>
  );
}
