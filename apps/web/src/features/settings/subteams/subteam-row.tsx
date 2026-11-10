import { t } from '@app/lib/i18n';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import type { Subteam } from '@service-auth/generated/schemas/subteam';
import { SubteamJoinPolicy } from '@service-auth/generated/schemas/subteamJoinPolicy';
import { Show } from 'solid-js';
import { AvatarStack, SubteamMark } from './subteam-mark';

/** A team in a list; nested teams indent under their parent. */
export function SubteamRow(props: {
  subteam: Subteam;
  nested?: boolean;
  onOpen: () => void;
}) {
  const userIds = () => props.subteam.members.map((member) => member.userId);

  return (
    <button
      type="button"
      class="group relative flex w-full items-center gap-3 py-3.5 pr-4 text-left hover:bg-hover"
      classList={{ 'pl-12': props.nested, 'pl-4': !props.nested }}
      onClick={props.onOpen}
    >
      <Show when={props.nested}>
        <span class="pointer-events-none absolute top-0 left-8 h-1/2 w-2.5 rounded-bl-md border-b border-l border-edge" />
      </Show>
      <SubteamMark name={props.subteam.name} color={props.subteam.color} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
          {props.subteam.name}
          <Show
            when={props.subteam.joinPolicy === SubteamJoinPolicy.invite_only}
          >
            <LockIcon
              class="size-3.5 shrink-0 text-ink-muted"
              aria-label={t('settingsTeams.inviteOnly')}
            />
          </Show>
        </div>
        <Show when={props.subteam.description}>
          <div class="truncate text-xs text-ink-muted">
            {props.subteam.description}
          </div>
        </Show>
      </div>
      <AvatarStack userIds={userIds()} inert />
      <span class="w-6 text-right text-xs tabular-nums text-ink-muted">
        {userIds().length}
      </span>
      <CaretRightIcon class="size-4 shrink-0 text-ink-muted group-hover:text-ink" />
    </button>
  );
}
