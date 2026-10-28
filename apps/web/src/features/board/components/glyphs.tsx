import { t } from '@app/lib/i18n';
import ArrowBendUpLeftIcon from '@icon/system/regular/arrow-bend-up-left.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import ChatCircleIcon from '@icon/system/regular/chat-circle.svg';
import ChatCircleDotsIcon from '@icon/system/regular/chat-circle-dots.svg';
import ChatsCircleIcon from '@icon/system/regular/chats-circle.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import CircleIcon from '@icon/system/regular/circle.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import FolderSimpleIcon from '@icon/system/regular/folder-simple.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import HashStraightIcon from '@icon/system/regular/hash-straight.svg';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { cn } from '@ui';
import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { BoardItemKind, BoardZone } from '../core/item';

type Glyph = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

export function kindGlyph(kind: BoardItemKind): Glyph {
  return match(kind)
    .returnType<Glyph>()
    .with('channel', () => HashStraightIcon)
    .with('dm', () => ChatCircleIcon)
    .with('thread', () => ArrowBendUpLeftIcon)
    .with('email', () => EnvelopeIcon)
    .with('document', () => FileTextIcon)
    .with('task', () => CheckSquareIcon)
    .with('project', () => FolderSimpleIcon)
    .with('agent', () => SparkleIcon)
    .with('chat', () => ChatCircleDotsIcon)
    .with('event', () => CalendarBlankIcon)
    .with('call', () => PhoneCallIcon)
    .with('pull-request', () => GitPullRequestIcon)
    .with('other', () => CircleIcon)
    .exhaustive();
}

export function zoneGlyph(zone: BoardZone): Glyph {
  return match(zone)
    .returnType<Glyph>()
    .with('channels', () => HashStraightIcon)
    .with('dms', () => ChatsCircleIcon)
    .with('email', () => EnvelopeIcon)
    .with('docs', () => FileTextIcon)
    .with('agents', () => SparkleIcon)
    .with('calendar', () => CalendarBlankIcon)
    .with('code', () => GitPullRequestIcon)
    .exhaustive();
}

export function zoneName(zone: BoardZone): string {
  return match(zone)
    .with('channels', () => t('board.zoneChannels'))
    .with('dms', () => t('board.zoneDms'))
    .with('email', () => t('board.zoneEmail'))
    .with('docs', () => t('board.zoneDocs'))
    .with('agents', () => t('board.zoneAgents'))
    .with('calendar', () => t('board.zoneCalendar'))
    .with('code', () => t('board.zoneCode'))
    .exhaustive();
}

/**
 * Each neighborhood's hue, reused from the app's entity colors so a zone
 * reads like the items it holds. Used as the `--board-zone` custom property.
 */
export function zoneColor(zone: BoardZone): string {
  return match(zone)
    .with('channels', () => 'var(--color-chat)')
    .with('dms', () => 'var(--color-blue)')
    .with('email', () => 'var(--color-violet)')
    .with('docs', () => 'var(--color-task)')
    .with('agents', () => 'var(--color-purple)')
    .with('calendar', () => 'var(--color-calendar)')
    .with('code', () => 'var(--color-code)')
    .exhaustive();
}

/** A kind glyph on a zone-tinted tile, for items no face fronts. */
export function KindTile(props: {
  kind: BoardItemKind;
  zone: BoardZone;
  size: number;
  class?: string;
}) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--board-zone)_18%,var(--color-panel))] text-[color-mix(in_oklch,var(--board-zone)_75%,var(--color-ink))]',
        props.class
      )}
      style={{
        '--board-zone': zoneColor(props.zone),
        width: `${props.size}px`,
        height: `${props.size}px`,
      }}
    >
      <Dynamic
        component={kindGlyph(props.kind)}
        style={{
          width: `${Math.round(props.size * 0.46)}px`,
          height: `${Math.round(props.size * 0.46)}px`,
        }}
      />
    </span>
  );
}

/** A neighborhood's name with its glyph, tinted with the zone's hue. */
export function ZoneTitle(props: {
  zone: BoardZone;
  count?: number;
  class?: string;
}) {
  return (
    <span
      class={cn('flex min-w-0 items-center gap-[0.55em]', props.class)}
      style={{ '--board-zone': zoneColor(props.zone) }}
    >
      {/* Sized in em so the glyph grows with far-zoom titles. */}
      <span class="flex size-[1.75em] shrink-0 items-center justify-center rounded-[0.5em] bg-[color-mix(in_oklch,var(--board-zone)_20%,transparent)] text-[color-mix(in_oklch,var(--board-zone)_80%,var(--color-ink))]">
        <Dynamic component={zoneGlyph(props.zone)} class="size-[1em]" />
      </span>
      <span class="truncate font-semibold text-ink">
        {zoneName(props.zone)}
      </span>
      {props.count !== undefined && (
        <span class="shrink-0 tabular-nums text-ink-extra-muted">
          {props.count}
        </span>
      )}
    </span>
  );
}
