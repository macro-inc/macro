import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, tryMacroId } from '@core/user';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import type { Message } from '@service-storage/messages';
import { Layer } from '@ui';

/** Says the channel has moved on while you're in the call's thread. */
export function OutsideMessagesPopup(props: {
  messages: Message[];
  onView: () => void;
}) {
  const latest = () => props.messages[props.messages.length - 1];
  const senderName = () =>
    getDisplayName(tryMacroId(latest().sender_id)).split(/\s+/)[0] ||
    t('calls.someone');

  return (
    <Layer depth={3}>
      <button
        type="button"
        class="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-edge-muted bg-surface py-1.5 pr-3 pl-1.5 text-xs whitespace-nowrap shadow-lg not-touch:hover:overlay-hover not-touch:active:overlay-active"
        onClick={() => props.onView()}
      >
        <span class="size-5 shrink-0 *:size-full *:rounded-full">
          <UserIcon
            id={latest().sender_id}
            size="fill"
            suppressClick
            showTooltip={false}
          />
        </span>
        <span class="text-ink">
          {t('calls.outsideMessages', {
            count: props.messages.length,
            name: senderName(),
          })}
        </span>
        <span class="flex items-center gap-1 font-medium text-accent">
          {t('calls.viewChannel')}
          <ArrowUpRightIcon class="size-3" />
        </span>
      </button>
    </Layer>
  );
}
