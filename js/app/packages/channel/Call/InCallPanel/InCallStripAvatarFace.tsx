import { Show, createMemo, type Component } from 'solid-js';
import { tryMacroId, useDisplayName } from '@core/user';
import { Tooltip } from '@core/component/Tooltip';
import { UserIcon } from '@core/component/UserIcon';
import {
  StackedAvatarsDefaultEmptyPlaceholder,
  stackedAvatarInnerClass,
  type StackedAvatarInput,
  type StackedAvatarsSize,
} from '@core/component/StackedAvatarsRow';

/** Matches {@link UserIcon} `lg` (`size-10`) for the in-call strip. */
export const IN_CALL_STRIP_FACE_SIZE = 'lg' satisfies StackedAvatarsSize;

/** Stable id for the local slot before `room().localParticipant.identity` is available. */
export const IN_CALL_LOCAL_STRIP_PENDING_ID = '__in_call_local_pending__';

export type InCallStripFace = StackedAvatarInput & {
  stripMemberKind: 'local' | 'remote';
  /** Local participant: show ring placeholder until LiveKit identity is ready for `UserIcon`. */
  stripLocalPending?: boolean;
};

export const InCallStripAvatarFace: Component<{
  face: InCallStripFace;
  trackCall?: () => unknown;
}> = (props) => {
  const [displayName] = useDisplayName(
    props.face.stripLocalPending ? undefined : tryMacroId(props.face.userId),
  );

  const nameLabel = createMemo(() => {
    props.trackCall?.();
    if (props.face.stripLocalPending) return 'You';
    const fromProfile = displayName()?.trim();
    if (fromProfile) return fromProfile;
    const liveKit = props.face.tooltip?.trim();
    if (liveKit) return liveKit;
    return (
      props.face.userId?.split('|').at(1)?.split('@')[0] ||
      (props.face.stripMemberKind === 'remote' ? 'Participant' : 'You')
    );
  });

  return (
    <Tooltip
      tooltip={
        <span class="wrap-break-word text-ink">{nameLabel()}</span>
      }
    >
      <Show
        when={props.face.stripLocalPending}
        fallback={
          <div class={stackedAvatarInnerClass(IN_CALL_STRIP_FACE_SIZE)}>
            <UserIcon
              id={props.face.userId}
              isDeleted={false}
              size="fill"
              showTooltip={false}
              suppressClick
            />
          </div>
        }
      >
        <StackedAvatarsDefaultEmptyPlaceholder size={IN_CALL_STRIP_FACE_SIZE} />
      </Show>
    </Tooltip>
  );
};
