import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import UserPlusIcon from '@phosphor/user-plus.svg';
import { Button, Tabs } from '@ui';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { ParticipantsActionSheet } from './ParticipantsActionSheet';

export function ParticipantsMobileLayout(props: {
  search: () => JSX.Element;
  list: () => JSX.Element;
  inviteLink?: () => JSX.Element;
  addParticipants?: (onAdded: () => void) => JSX.Element;
  bots?: (inviteRequest: number) => JSX.Element;
  settings?: () => JSX.Element;
  inviteBotFocusRequest: number;
}) {
  const [selection, setSelection] = createSignal({
    tab: props.inviteBotFocusRequest > 0 && props.bots ? 'bots' : 'people',
    request: 0,
  });
  const [adding, setAdding] = createSignal(false);
  // A request from the channel's invite menu opens Bots even if People was selected.
  const tab = () =>
    props.bots && props.inviteBotFocusRequest !== selection().request
      ? 'bots'
      : selection().tab;

  return (
    <div class="flex h-full min-h-0 flex-col gap-2 px-3 pt-2 pb-[calc(var(--mobile-content-inset-bottom,0px)+0.5rem)]">
      {/* Management screens reserve no space for the fallback AI composer. */}
      <FloatRegion region="accessory" />
      <div class="shrink-0 overflow-x-auto scrollbar-hidden">
        <Tabs
          aria-label="Channel participants"
          list={[
            { value: 'people', label: 'People' },
            ...(props.bots ? [{ value: 'bots', label: 'Bots' }] : []),
            ...(props.settings
              ? [{ value: 'settings', label: 'Settings' }]
              : []),
          ]}
          value={tab()}
          onChange={(tab) =>
            setSelection({ tab, request: props.inviteBotFocusRequest })
          }
          class="h-11"
          labelClass="h-11"
        />
      </div>
      <Switch>
        <Match when={tab() === 'people'}>
          <div class="flex shrink-0 items-center gap-2">
            <div class="min-w-0 flex-1">{props.search()}</div>
            {props.inviteLink?.()}
            <Show when={props.addParticipants}>
              <Button
                variant="outline"
                size="icon-md"
                label="Add participants"
                onClick={() => setAdding(true)}
              >
                <UserPlusIcon />
              </Button>
            </Show>
          </div>
          <div class="min-h-0 flex-1">{props.list()}</div>
        </Match>
        <Match when={tab() === 'bots'}>
          {props.bots?.(
            props.inviteBotFocusRequest !== selection().request
              ? props.inviteBotFocusRequest
              : 0
          )}
        </Match>
        <Match when={tab() === 'settings'}>
          <div class="min-h-0 flex-1 overflow-y-auto">{props.settings?.()}</div>
        </Match>
      </Switch>
      <Show when={props.addParticipants}>
        {(add) => (
          <ParticipantsActionSheet
            title="Add participants"
            open={adding()}
            onOpenChange={setAdding}
          >
            {add()(() => setAdding(false))}
          </ParticipantsActionSheet>
        )}
      </Show>
    </div>
  );
}
