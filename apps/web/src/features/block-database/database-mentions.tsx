import { CellMentionEditor } from '@app/components/cell-text-editor/CellMentionEditor';
import { LinkWithPreview } from '@core/component/LexicalMarkdown/component/core/LinkWithPreview';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu';
import { getBlockNameFromEntity } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu/utils/entityUtils';
import {
  createMenuOperations,
  type MenuOperations,
} from '@core/component/LexicalMarkdown/shared/inlineMenu';
import { theme } from '@core/component/LexicalMarkdown/theme';
import type { MentionItem } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import { normalizeLinkUrl } from '@macro-inc/lexical-core/utils/auto-link';
import { encodeCellMention } from '@macro-inc/spreadsheet/cell-mentions';
import { usePropertyEntityDisplay } from '@property/hooks/usePropertyEntityDisplay';
import { ErrorBoundary, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import {
  DatabaseMentionLabel,
  DatabaseMentionPlaceholder,
} from '../database/components/database-mention-label';
import type {
  DatabaseMentionPickerProps,
  DatabaseTextEditorProps,
} from '../database/components/grid-cell';
import type { DatabaseEntityType } from '../database/core/column-inference';
import {
  databaseMentionFromItem,
  databaseMentionScope,
} from './core/native-mentions';

/** The same menu used by documents, constrained at its native query source. */
export function DatabaseMentionPicker(props: DatabaseMentionPickerProps) {
  const menu = createMenuOperations();
  menu.openMenu();
  const operations: MenuOperations = {
    ...menu,
    searchTerm: () => props.search,
    setSearchTerm: (value) => props.onSearchChange?.(value),
    setIsOpen: (value) => {
      const next = typeof value === 'function' ? value(menu.isOpen()) : value;
      menu.setIsOpen(() => next);
      if (!next) props.onClose();
      return next;
    },
  };
  return (
    <Show when={props.anchor}>
      {(anchor) => (
        <MentionsMenu
          animate={false}
          menu={operations}
          anchor={anchor()}
          portalMount={props.mount}
          {...databaseMentionScope(props.specificEntityType)}
          includeContacts={false}
          showOpenTabs={false}
          includeGroups={false}
          onPick={(item) => {
            const mention = databaseMentionFromItem(item);
            if (
              mention &&
              (!props.specificEntityType ||
                mention.entityType === props.specificEntityType)
            ) {
              props.onSelect(mention);
              return;
            }
            toast.failure(
              mention
                ? 'This column holds another kind of mention. Choose one it lists.'
                : 'This mention cannot go in a database cell.'
            );
          }}
        />
      )}
    </Show>
  );
}

function encodedMention(item: MentionItem): string | undefined {
  return match(item)
    .returnType<string | undefined>()
    .with({ kind: 'user' }, ({ data }) =>
      encodeCellMention({
        type: 'user',
        userId: data.id,
        email: data.email,
        displayName: data.name,
      })
    )
    .with({ kind: 'entity' }, (entity) =>
      encodeCellMention({
        type: 'document',
        documentId: entity.data.id,
        documentName: entity.data.name ?? '',
        blockName: getBlockNameFromEntity(entity),
      })
    )
    .otherwise(() => undefined);
}

export function DatabaseTextEditor(props: DatabaseTextEditorProps) {
  return (
    <CellMentionEditor
      {...props}
      convertPaste={(text) => text}
      renderMenu={(menu, anchor, pick) => (
        <MentionsMenu
          menu={menu}
          anchor={anchor}
          sources={['users', 'documents', 'channels', 'emails']}
          includeGroups={false}
          showOpenTabs={false}
          onPick={(item) => {
            const mention = databaseMentionFromItem(item);
            if (
              props.inferType &&
              props.value.startsWith('@') &&
              mention &&
              props.onInferMention
            ) {
              props.onInferMention(mention);
              return;
            }
            const value = encodedMention(item);
            if (value) pick(value);
          }}
        />
      )}
    />
  );
}

/**
 * A text cell's Markdown: its first paragraph on one line, as a grid shows
 * it. A `fit` is for a property list: `line` lets a cut value end in an
 * ellipsis, and `clamp` and `full` show every paragraph, cut to two lines or
 * in full.
 */
export function DatabaseTextValue(props: {
  value: string;
  fit?: 'line' | 'clamp' | 'full';
}) {
  return (
    <Show
      when={props.fit === 'clamp' || props.fit === 'full'}
      fallback={
        <span
          class="[&_.markdown]:inline [&_p]:inline [&_p]:m-0 [&_p]:leading-normal"
          classList={{ '[&_.markdown-content]:inline': props.fit === 'line' }}
          onPointerDown={stopLinkPointerDown}
        >
          <StaticMarkdown markdown={props.value} singleLine target="internal" />
        </span>
      }
    >
      <span
        class="[&_p]:my-0! [&_p+p]:mt-2!"
        classList={{ 'line-clamp-2': props.fit === 'clamp' }}
        onPointerDown={stopLinkPointerDown}
      >
        <StaticMarkdown markdown={props.value} target="internal" />
      </span>
    </Show>
  );
}

/** Keeps a press on a link inside a cell from reaching the grid's bubbling handlers (row menus, card drags). */
function stopLinkPointerDown(event: PointerEvent) {
  if (
    event.target instanceof Element &&
    event.target.closest('a,[data-mention]')
  )
    event.stopPropagation();
}

/**
 * A web address or email address, as a link. A bare word such as `TBD` would
 * otherwise become `https://tbd`, a link that goes nowhere.
 */
function linkHref(value: string): string | null {
  const href = normalizeLinkUrl(value);
  if (!href) return null;
  // normalizeLinkUrl returns only addresses the URL parser accepted.
  const url = new URL(href);
  if (url.protocol === 'mailto:') return href;
  return url.hostname.includes('.') || url.hostname === 'localhost'
    ? href
    : null;
}

/** A URL cell's value as the link it names, opened as links open in documents. */
export function DatabaseLinkValue(props: { url: string }) {
  const href = () => linkHref(props.url);
  return (
    <Show when={href()} fallback={props.url}>
      {(href) => (
        <span onPointerDown={stopLinkPointerDown}>
          <LinkWithPreview url={href()} class={theme.link} title={href()}>
            {props.url}
          </LinkWithPreview>
        </span>
      )}
    </Show>
  );
}

function ResolvedMentionValue(props: {
  id: string;
  entityType: DatabaseEntityType;
}) {
  const display = usePropertyEntityDisplay(
    () => props.id,
    () => props.entityType
  );
  return (
    <DatabaseMentionLabel
      entityType={props.entityType}
      name={display.name()}
      icon={
        <Show when={props.entityType === 'USER'} fallback={display.icon()}>
          <UserIcon id={props.id} size="sm" suppressClick showTooltip={false} />
        </Show>
      }
    />
  );
}

/** A label lookup must never suspend the surrounding grid or its active editor. */
export function DatabaseMentionValue(props: {
  id: string;
  entityType: DatabaseEntityType;
}) {
  const fallback = () => (
    <DatabaseMentionPlaceholder entityType={props.entityType} />
  );
  return (
    <ErrorBoundary fallback={fallback()}>
      <Suspense fallback={fallback()}>
        <ResolvedMentionValue {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
