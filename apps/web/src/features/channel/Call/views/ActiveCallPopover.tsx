import { t } from '@app/lib/i18n';
import { IS_MAC } from '@core/constant/isMac';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import CornersIn from '@icon/system/regular/corners-in.svg';
import CornersOut from '@icon/system/regular/corners-out.svg';
import DotsThree from '@icon/system/regular/dots-three.svg';
import Hash from '@icon/system/regular/hash.svg';
import PictureInPicture from '@icon/system/regular/picture-in-picture.svg';
import { Popover } from '@kobalte/core/popover';
import { useLiveCallRecordQuery } from '@queries/call/call';
import { Button, Dropdown, Hotkey } from '@ui';
import { Show } from 'solid-js';
import { useQuickCallsFlag } from '../../../meetings/use-quick-calls-flag';
import { ActiveCallLink } from '../ActiveCallLink';
import { useCallContext } from '../CallContext';
import { CallParticipantsList } from '../CallParticipantsList';
import { CallLiveChip } from '../components/CallLiveChip';
import { createCallReactions } from '../primitives/create-call-reactions';
import { CallQuickControls } from './CallQuickControls';
import { useCallFullscreenOptional } from './call-fullscreen-host';

export function ActiveCallPopover(props: {
  onOpenCall: () => void;
  onShowPlayer?: () => void;
}) {
  const call = useCallContext();
  const reactions = createCallReactions(call.room);
  const quickCalls = useQuickCallsFlag();
  const fullscreen = useCallFullscreenOptional()?.fullscreen;
  const record = useLiveCallRecordQuery(() => call.activeCallId() ?? '');
  return (
    <Popover.Content class="menu-surface z-modal w-75 max-w-[calc(100vw-1rem)] overflow-hidden outline-none animate-menu-open">
      <div class="flex min-w-0 items-center gap-2 p-3">
        <Hash class="size-4 shrink-0 text-ink-muted" />
        <div class="flex min-w-0 flex-1 items-center gap-1">
          <Popover.Title class="min-w-0 truncate text-sm font-semibold">
            {record.isSuccess
              ? record.data.channelName || t('nav.returnToCall')
              : t('nav.returnToCall')}
          </Popover.Title>
          <CallLiveChip
            bare
            hideWave
            startedAt={record.isSuccess ? record.data.startedAt : undefined}
          />
        </div>
        <Show
          when={
            fullscreen?.available() ||
            props.onShowPlayer ||
            (!quickCalls().loading && quickCalls().enabled)
          }
        >
          <Dropdown placement="bottom-end">
            <Dropdown.Trigger
              variant="ghost"
              size="icon-sm"
              aria-label={t('calls.more')}
              tooltip={t('calls.more')}
            >
              <DotsThree class="size-4 shrink-0 pointer-events-none" />
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-56">
              <Dropdown.Group>
                <Show when={props.onShowPlayer}>
                  <Dropdown.Item onSelect={props.onShowPlayer}>
                    <PictureInPicture class="size-4 shrink-0" />
                    <span class="flex-1 truncate">{t('calls.showPlayer')}</span>
                  </Dropdown.Item>
                </Show>
                <ActiveCallLink menuItem />
                <Show when={fullscreen}>
                  {(control) => (
                    <Dropdown.Item
                      disabled={!control().available()}
                      onSelect={() => {
                        if (control().active())
                          fireAndForget(control().exit(), 'call-fullscreen');
                        else {
                          const entering = control().enter();
                          props.onOpenCall();
                          fireAndForget(entering, 'call-fullscreen');
                        }
                      }}
                    >
                      <Show
                        when={control().active()}
                        fallback={<CornersOut class="size-4" />}
                      >
                        <CornersIn class="size-4" />
                      </Show>
                      <span class="flex-1">
                        {control().active()
                          ? t('calls.exitFullscreen')
                          : t('calls.fullscreen')}
                      </span>
                      <Hotkey
                        shortcut={IS_MAC ? 'ctrl+cmd+f' : 'f11'}
                        theme="subtle"
                      />
                    </Dropdown.Item>
                  )}
                </Show>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
        </Show>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('nav.returnToCall')}
          tooltip={t('nav.returnToCall')}
          onClick={props.onOpenCall}
        >
          <ArrowSquareOut class="size-4" />
        </Button>
      </div>
      <div class="max-h-72 overflow-y-auto px-1 pb-2">
        <CallParticipantsList compact />
      </div>
      <div class="border-t border-edge-muted">
        <CallQuickControls.Root>
          <CallQuickControls.Settings>
            <CallQuickControls.MediaMicrophone />
            <CallQuickControls.MediaCamera />
            <CallQuickControls.MediaScreen />
            <CallQuickControls.Reactions
              onReaction={(emoji) =>
                fireAndForget(reactions.send(emoji), 'active-call-popover')
              }
            />
            <CallQuickControls.MediaLeave />
          </CallQuickControls.Settings>
        </CallQuickControls.Root>
      </div>
    </Popover.Content>
  );
}
