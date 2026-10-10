import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { formatDate } from '@core/util/date';
import { isAccessiblePreviewItem } from '@queries/preview/types';
import type { ItemType } from '@service-storage/client';
import { Match, Switch } from 'solid-js';
import { actionLabel, documentKind } from '../core/labels';
import type { CardAction, CardItemType } from '../core/types';
import { CardShell, IconTile } from './card-shell';

const ITEM_TYPES: Record<Exclude<CardItemType, 'calendar_event'>, ItemType> = {
  document: 'document',
  email_thread: 'email',
};

/**
 * A document, spreadsheet or email thread, loaded with the viewer's own
 * access. Before it loads, and for a viewer who cannot open it, the card
 * names it as the agent knew it.
 */
export function EntityCard(props: {
  type: Exclude<CardItemType, 'calendar_event'>;
  id: string;
  fileType?: string | null;
  action?: CardAction;
  title?: string | null;
}) {
  const data = useItemPreviewData(() => ({
    id: props.id,
    type: ITEM_TYPES[props.type],
  }));
  const preview = () => data.item();
  const accessible = () => {
    const item = preview();
    return isAccessiblePreviewItem(item) ? item : undefined;
  };
  const fileType = () => accessible()?.fileType ?? props.fileType ?? undefined;
  const fallbackName = () =>
    props.title ||
    (props.type === 'email_thread' ? 'Email' : documentKind(props.fileType));
  const title = () => (accessible() ? data.name() : fallbackName());
  const missing = () => {
    const item = preview();
    return item.loading ? undefined : item.access;
  };
  const kind = () =>
    props.type === 'email_thread' ? 'Email' : documentKind(fileType());
  const when = () => {
    const updatedAt = accessible()?.updatedAt;
    return updatedAt ? formatDate(updatedAt) : undefined;
  };
  // Until the item loads, or for a viewer who cannot open it, the icon
  // follows what the agent said it was.
  const iconType = (): EntityIconSelector => {
    if (accessible()) return data.targetType();
    if (props.type === 'email_thread') return 'email';
    return props.fileType === 'spreadsheet' ? 'spreadsheet' : 'md';
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
    <CardShell
      tile={
        <IconTile>
          <EntityIcon targetType={iconType()} size="sm" />
        </IconTile>
      }
      title={title()}
      badge={props.action ? actionLabel(props.type, props.action) : undefined}
      meta={
        <Switch
          fallback={
            <>
              {kind()}
              {accessible()?.owner && props.type === 'email_thread'
                ? ` · ${accessible()?.owner}`
                : ''}
              {when()
                ? props.type === 'email_thread'
                  ? ` · ${when()}`
                  : ` · Updated ${when()}`
                : ''}
            </>
          }
        >
          <Match when={missing() === 'no_access'}>
            {kind()} · You don't have access
          </Match>
          <Match when={missing() === 'does_not_exist'}>
            {kind()} · Deleted
          </Match>
        </Switch>
      }
      onOpen={accessible() ? open : undefined}
      muted={missing() === 'no_access' || missing() === 'does_not_exist'}
    />
  );
}
