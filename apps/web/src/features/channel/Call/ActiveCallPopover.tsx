import { t } from '@app/lib/i18n';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import DotsThree from '@icon/system/regular/dots-three.svg';
import Hash from '@icon/system/regular/hash.svg';
import PictureInPicture from '@icon/system/regular/picture-in-picture.svg';
import { Popover } from '@kobalte/core/popover';
import { useLiveCallRecordQuery } from '@queries/call/call';
import { Button, Dropdown } from '@ui';
import { Show } from 'solid-js';
import { ActiveCallLink } from './ActiveCallLink';
import { useCallContext } from './CallContext';
import { CallLiveChip } from './CallLiveChip';
import { CallParticipantsList } from './CallParticipantsList';
import { CallQuickControls } from './CallQuickControls';

export function ActiveCallPopover(props: {
  onOpenCall: () => void;
  onShowPlayer?: () => void;
}) {
  const call = useCallContext();
  const record = useLiveCallRecordQuery(() => call.activeCallId() ?? '');
  return (
    <Popover.Content class="menu-surface z-modal w-75 max-w-[calc(100vw-1rem)] overflow-hidden outline-none animate-menu-open">
      <div class="flex min-w-0 items-center gap-2 p-3">
        <Hash class="size-4 shrink-0 text-ink-muted" />
        <Popover.Title class="min-w-0 flex-1 truncate text-sm font-semibold">
          {record.isSuccess
            ? record.data.channelName || t('nav.returnToCall')
            : t('nav.returnToCall')}
        </Popover.Title>
        <CallLiveChip
          bare
          hideWave
          startedAt={record.isSuccess ? record.data.startedAt : undefined}
        />
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
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
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
        <CallQuickControls
          settings
          controls={['camera', 'screen', 'sharing']}
          channelName={
            record.isSuccess && record.data.discussion.kind === 'channel_thread'
              ? (record.data.channelName ?? undefined)
              : undefined
          }
        />
      </div>
    </Popover.Content>
  );
}
