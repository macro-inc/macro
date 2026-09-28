import {
  type StackedAvatarInput,
  StackedAvatarsDefaultEmptyPlaceholder,
  type StackedAvatarsSize,
  stackedAvatarInnerClass,
} from '@core/component/StackedAvatarsRow';
import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, tryMacroId } from '@core/user';
import { Tooltip } from '@ui';
import { type Component, Show } from 'solid-js';

/** Matches {@link UserIcon} `lg` (`size-10`) for the in-call strip. */
export const IN_CALL_STRIP_IMAGE_SIZE = 'lg' satisfies StackedAvatarsSize;

/** Stable id for the local slot before `room().localParticipant.identity` is available. */
export const IN_CALL_LOCAL_STRIP_PENDING_ID = '__in_call_local_pending__';

export type InCallStripImage = StackedAvatarInput & {
  stripMemberKind: 'local' | 'remote';
  /** Local participant: show ring placeholder until LiveKit identity is ready for `UserIcon`. */
  stripLocalPending?: boolean;
};

export const InCallStripAvatarImage: Component<{
  image: InCallStripImage;
  trackCall?: () => unknown;
}> = (props) => {
  const displayName = () =>
    getDisplayName(
      props.image.stripLocalPending ? undefined : tryMacroId(props.image.userId)
    );

  const nameLabel = () => {
    props.trackCall?.();
    if (props.image.stripLocalPending) return 'You';
    const fromProfile = displayName()?.trim();
    if (fromProfile) return fromProfile;
    const liveKit = props.image.tooltip?.trim();
    if (liveKit) return liveKit;
    return (
      props.image.userId?.split('|').at(1)?.split('@')[0] ||
      (props.image.stripMemberKind === 'remote' ? 'Participant' : 'You')
    );
  };

  return (
    <Tooltip label={nameLabel()}>
      <Show
        when={props.image.stripLocalPending}
        fallback={
          <div class={stackedAvatarInnerClass(IN_CALL_STRIP_IMAGE_SIZE)}>
            <Show
              when={tryMacroId(props.image.userId)}
              fallback={
                <div class="flex size-full items-center justify-center rounded-full bg-ink-extra-muted text-sm text-surface">
                  {nameLabel().charAt(0).toUpperCase()}
                </div>
              }
            >
              {(id) => (
                <UserIcon
                  id={id()}
                  isDeleted={false}
                  size="fill"
                  showTooltip={false}
                  suppressClick
                />
              )}
            </Show>
          </div>
        }
      >
        <StackedAvatarsDefaultEmptyPlaceholder
          size={IN_CALL_STRIP_IMAGE_SIZE}
        />
      </Show>
    </Tooltip>
  );
};
