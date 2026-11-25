import { t } from '@app/lib/i18n';
import ChatCircleIcon from '@icon/system/regular/chat-circle.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import UserIcon from '@icon/system/regular/user.svg';
import UsersThreeIcon from '@icon/system/regular/users-three.svg';
import { cn, Tooltip } from '@ui';
import { Show } from 'solid-js';
import type { DriveShareProvenance } from '../../core/drive-share-provenance';

export function shareProvenanceLabel(provenance: DriveShareProvenance): string {
  switch (provenance.kind) {
    case 'direct':
      return t('drive.sharedBadgeDirect');
    case 'dm':
      return t('drive.sharedBadgeDm');
    case 'channel':
      return provenance.channelName || t('drive.sharedBadgeChannelFallback');
    case 'team':
      return provenance.teamName || t('drive.sharedBadgeTeamFallback');
  }
}

export function shareProvenanceDescription(
  provenance: DriveShareProvenance
): string {
  switch (provenance.kind) {
    case 'direct':
      return t('drive.sharedTooltipDirect');
    case 'dm':
      return t('drive.sharedTooltipDm');
    case 'channel':
      return provenance.channelName
        ? t('drive.sharedTooltipChannel', { name: provenance.channelName })
        : t('drive.sharedTooltipChannelFallback');
    case 'team':
      return provenance.teamName
        ? t('drive.sharedTooltipTeam', { name: provenance.teamName })
        : t('drive.sharedTooltipTeamFallback');
  }
}

/**
 * Compact badge communicating how a shared item reached the viewer:
 * - `Direct` / `DM` receive a subtle accent tint for high-signal personal shares
 * - `#channel` / `Team` use a calm inset neutral treatment
 */
export function ShareProvenanceBadge(props: {
  provenance: DriveShareProvenance | undefined;
  fallbackShared?: boolean;
  compact?: boolean;
  class?: string;
}) {
  const isDirectStyle = () =>
    props.provenance?.kind === 'direct' || props.provenance?.kind === 'dm';

  return (
    <Show
      when={props.provenance}
      fallback={
        <Show when={props.fallbackShared}>
          <span
            class={cn(
              'shrink-0 rounded-full bg-inset px-1.5 py-0.5 text-[11px] text-ink-muted',
              props.class
            )}
          >
            {t('drive.sharedLabel')}
          </span>
        </Show>
      }
    >
      {(prov) => (
        <Tooltip label={shareProvenanceDescription(prov())}>
          <span
            data-share-provenance={prov().kind}
            class={cn(
              'inline-flex max-w-32 shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] leading-tight font-medium',
              isDirectStyle()
                ? 'bg-accent/12 text-accent'
                : 'bg-inset text-ink-muted',
              props.compact && 'max-w-24 text-[10px]',
              props.class
            )}
          >
            <Show when={prov().kind === 'direct'}>
              <UserIcon class="size-2.5 shrink-0" aria-hidden="true" />
            </Show>
            <Show when={prov().kind === 'dm'}>
              <ChatCircleIcon class="size-2.5 shrink-0" aria-hidden="true" />
            </Show>
            <Show when={prov().kind === 'channel'}>
              <HashIcon class="size-2.5 shrink-0" aria-hidden="true" />
            </Show>
            <Show when={prov().kind === 'team'}>
              <UsersThreeIcon class="size-2.5 shrink-0" aria-hidden="true" />
            </Show>
            <span class="truncate">{shareProvenanceLabel(prov())}</span>
          </span>
        </Tooltip>
      )}
    </Show>
  );
}
