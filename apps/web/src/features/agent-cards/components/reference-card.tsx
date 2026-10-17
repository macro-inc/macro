import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { formatDate } from '@core/util/date';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import { isAccessiblePreviewItem } from '@queries/preview/types';
import type { ItemType } from '@service-storage/client';
import { type JSX, Show } from 'solid-js';
import { actionLabel, actionTone, itemKind } from '../core/labels';
import type { CardAction, CardItemType } from '../core/types';
import { Card, CardSingle } from './kit/card';
import { CardBadge, type CardTone, Tile } from './kit/parts';

/** The card types the preview service loads by id, and as what. */
export type LoadableType = Exclude<CardItemType, 'calendar_event'>;

export const PREVIEW_TYPES: Record<LoadableType, ItemType> = {
  document: 'document',
  email_thread: 'email',
  project: 'project',
  channel: 'channel',
  routine: 'routine',
  form: 'form',
  initiative: 'initiative',
};

const FALLBACK_ICONS: Record<Exclude<LoadableType, 'document'>, string> = {
  email_thread: 'email',
  project: 'project',
  channel: 'channel',
  routine: 'routine',
  form: 'form',
  initiative: 'initiative',
};

/** The icon an item gets before it loads: what the agent said it was. */
export function fallbackIcon(
  type: LoadableType,
  fileType?: string | null
): EntityIconSelector {
  if (type === 'document') {
    return (fileType?.toLowerCase() || 'md') as EntityIconSelector;
  }
  return FALLBACK_ICONS[type] as EntityIconSelector;
}

/** The arrow a card that opens its item ends with. */
export function OpenArrow() {
  return (
    <ArrowUpRight
      class="size-4 flex-none text-ink-subtle transition-colors group-hover/card:text-ink-muted"
      aria-hidden="true"
    />
  );
}

/**
 * One item as a card, from values already worked out: its tile, its name,
 * what happened to it, and a line about it. Always 72 tall; the whole card
 * opens the item when it can be opened.
 */
export function ReferenceCardView(props: {
  tile: JSX.Element;
  title: string;
  badge?: { label: string; tone: CardTone };
  meta: string;
  onOpen?: (event: MouseEvent) => void;
  /** Out of reach: no access, or gone. */
  muted?: boolean;
  /** Gone: the title is struck through. */
  deleted?: boolean;
  kind?: 'reference' | 'receipt';
}) {
  return (
    <Card
      width="compact"
      height={72}
      onOpen={props.onOpen}
      label={`Open ${props.title}`}
      muted={props.muted}
      data-agent-card={props.kind ?? (props.badge ? 'receipt' : 'reference')}
    >
      <CardSingle
        tile={props.tile}
        title={props.title}
        struck={props.deleted}
        badge={
          <Show when={props.badge}>
            {(badge) => (
              <CardBadge tone={badge().tone}>{badge().label}</CardBadge>
            )}
          </Show>
        }
        meta={props.meta}
        trailing={
          <Show when={props.onOpen}>
            <OpenArrow />
          </Show>
        }
      />
    </Card>
  );
}

/**
 * One workspace item, loaded with the viewer's own access: a reference when
 * the agent points at it, a receipt when a step made, changed or sent it.
 * Before the item loads, and for a viewer who cannot open it, the card names
 * the item as the agent knew it and says why it cannot be opened - never
 * what is inside, and never the receipt's summary.
 */
export function ReferenceCard(props: {
  type: LoadableType;
  id: string;
  fileType?: string | null;
  /** What a step did to it, for a receipt. */
  action?: CardAction;
  /** The item's name as the agent knew it, until it loads. */
  title?: string | null;
  /** What happened, in a few words: `3 changes`, `to Ana Ruiz`. */
  summary?: string | null;
}) {
  const data = useItemPreviewData(() => ({
    id: props.id,
    type: PREVIEW_TYPES[props.type],
  }));
  const preview = () => data.item();
  const accessible = () => {
    const item = preview();
    return isAccessiblePreviewItem(item) ? item : undefined;
  };
  const missing = () => {
    const item = preview();
    return item.loading ? undefined : item.access;
  };
  const fileType = () => accessible()?.fileType ?? props.fileType ?? undefined;
  const kind = () => itemKind(props.type, fileType());
  const title = () =>
    (accessible() ? data.name() : undefined) || props.title || kind();
  const meta = () => {
    if (missing() === 'no_access') return `${kind()} · You don't have access`;
    if (missing() === 'does_not_exist') return `${kind()} · Deleted`;
    // Messages stored before receipts stopped quoting their item can still
    // carry its words, so a summary waits until this viewer can open it.
    if (props.summary && accessible()) return `${kind()} · ${props.summary}`;
    const owner =
      props.type === 'email_thread' ? accessible()?.owner : undefined;
    const updatedAt = accessible()?.updatedAt;
    const updated = updatedAt ? formatDate(updatedAt) : undefined;
    return [
      kind(),
      owner,
      updated &&
        (props.type === 'email_thread' ? updated : `Updated ${updated}`),
    ]
      .filter(Boolean)
      .join(' · ');
  };
  const open = (event: MouseEvent) => {
    const item = accessible();
    if (!item) return;
    data.onPreviewClick(
      item.type,
      item.id,
      item.fileType,
      item.subType?.type,
      event.shiftKey
    );
  };

  return (
    <ReferenceCardView
      tile={
        <Tile>
          <EntityIcon
            targetType={
              accessible()
                ? data.targetType()
                : fallbackIcon(props.type, props.fileType)
            }
            size="sm"
          />
        </Tile>
      }
      title={title()}
      badge={
        props.action
          ? {
              label: actionLabel(props.type, props.action),
              tone: actionTone(props.action),
            }
          : undefined
      }
      meta={meta()}
      onOpen={accessible() ? open : undefined}
      muted={missing() === 'no_access' || missing() === 'does_not_exist'}
      deleted={missing() === 'does_not_exist'}
      kind={props.action ? 'receipt' : 'reference'}
    />
  );
}
