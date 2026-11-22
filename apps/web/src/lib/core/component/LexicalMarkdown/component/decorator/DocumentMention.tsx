import { externalChatApi } from '@app/features/external-chat/queries/production-api';
import { externalChatContent } from '@app/features/external-view/hosted-content';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { BlockAlias, BlockName } from '@core/block';
import {
  type DocumentPreviewContentProps,
  getMentionsIcon,
  mentionsAccessories,
  PopupPreview,
} from '@core/component/DocumentPreview';
import { DocumentPreviewSheet } from '@core/component/DocumentPreviewSheet';
import { EntityIcon } from '@core/component/EntityIcon';
import { HoverCard } from '@core/component/HoverCard';
import { InlineTaskProperties } from '@core/component/InlineTaskProperties';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { TaskStatusIcon } from '@core/component/TaskStatusIcon';
import { verifyBlockName } from '@core/constant/allBlocks';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { formatDate } from '@core/util/date';
import { parseLocalDate } from '@core/util/local-date';
import { matches } from '@core/util/match';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { ThrownResultError } from '@core/util/result';
import ArrowsOut from '@icon/system/regular/arrows-out-simple.svg';
import EyeSlashDuo from '@icon/system/regular/eye-slash.svg';
import TrashSimple from '@icon/system/regular/trash-simple.svg';
import type { DocumentMentionDecoratorProps } from '@macro-inc/lexical-core';
import { useExternalChatDetailQuery } from '@queries/external-chats';
import {
  type AccessiblePreviewItem,
  failedReadAccess,
  type ItemEntity,
  isAccessiblePreviewItem,
  isCalendarEventPreviewItem,
  type PreviewCalendarEventAccess,
  type PreviewItemNoAccess,
} from '@queries/preview';
import { useDatabaseDetailQuery } from '@queries/storage/databases';
import { useFormDetailQuery } from '@queries/storage/forms';
import { useSystemSkillsQuery } from '@queries/storage/system-skills';
import { createCallback } from '@solid-primitives/rootless';
import { Button, Tooltip } from '@ui';
import type { EditorThemeClasses } from 'lexical';
import type { Accessor, JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Suspense,
  Switch,
  useContext,
} from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import type { DocumentMentionHost } from '../../decorator-host/document-mention-host';
import { createLexicalDocumentMentionHost } from '../../decorator-host/lexical-document-mention';
import { UPDATE_DOCUMENT_NAME_COMMAND } from '../../plugins';
import { openDocument } from '../core/BlockLink';
import { DocumentMentionInner } from './DocumentMentionInner';

// Time threshold for showing fallback state for recently created mentions (1 minute)
const RECENT_MENTION_THRESHOLD_MS = 1 * 60 * 1000;

export type DocumentMentionProps = DocumentMentionDecoratorProps & {
  readonly host?: DocumentMentionHost;
  /** Dismiss a hosting dialog or sheet after the reference opens a split. */
  onOpened?: () => void;
  /** Host-authorized display data; hover previews still load through the shared query. */
  inlinePreview?: Accessor<AccessiblePreviewItem>;
};

/**
 * Determine if we should use fallback data for a mention due to stale preview cache.
 * This happens when a mention is very recent and the preview API returns does_not_exist
 * (likely due to cache staleness rather than actual deletion).
 */
export function shouldUseFallbackForRecentMention(
  previewItem: { loading: boolean; access?: string },
  isRecent: boolean
): boolean {
  return (
    !previewItem.loading && previewItem.access === 'does_not_exist' && isRecent
  );
}

function MentionContainer(props: {
  icon: JSX.Element;
  text: JSX.Element;
  collapsed?: boolean;
}) {
  return (
    <span class="pointer-events-auto">
      <span class="relative top-[0.125em] size-[1em] inline-flex mx-[0.25em]">
        {props.icon}
      </span>
      <Show when={!props.collapsed}>
        <span class="text-ink underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-[0.125em]">
          {props.text}
        </span>
      </Show>
    </span>
  );
}

/**
 * Skill mentions render as `/Skill Name` in the accent color rather than the
 * icon-and-underline pill other document mentions use. Same mention node and
 * data attributes — only the visual differs.
 *
 * Clicking opens the skill document. The listener is a native (`on:click`)
 * one rather than Solid's delegated `onClick`: inside an editable editor
 * Lexical stops click propagation before it reaches the document-level
 * delegation, so skill mentions in the chat input would otherwise be inert.
 * System skills have no document behind them and never open.
 */
function SkillSlashText(props: {
  documentId: string;
  name: string;
  collapsed?: boolean;
  dimmed?: boolean;
  onOpened?: () => void;
}) {
  const systemSkills = useSystemSkillsQuery();
  const openSkill = createCallback((e: MouseEvent) => {
    if (systemSkills.isSystemSkillId(props.documentId)) return;
    // Also keeps the outer mention click handler from opening the skill a
    // second time.
    e.stopPropagation();
    const result = openDocument(
      'skill',
      props.documentId,
      undefined,
      openInNewSplitForMention(e.shiftKey, true)
    );
    if (result && result.status !== 'unavailable') props.onOpened?.();
  });
  return (
    <span
      class="pointer-events-auto mx-1 text-accent"
      classList={{ 'opacity-50': props.dimmed }}
      on:mousedown={(e) => e.preventDefault()}
      on:click={openSkill}
    >
      <span
        data-document-mention="true"
        data-document-id={props.documentId}
        data-block-name="skill"
        data-document-name={props.name}
      >
        /
        <Show when={!props.collapsed}>
          {props.name.replaceAll('\n', ' ').trim()}
        </Show>
      </span>
    </span>
  );
}

/** Compact start-time label appended to a calendar event mention pill. */
export function calendarMentionTimeLabel(
  event: PreviewCalendarEventAccess['event']
): string | undefined {
  if (event.time.kind === 'timed') {
    return formatDate(event.time.startsAt, { showTime: true });
  }
  const startDate = parseLocalDate(event.time.startDate);
  return startDate ? formatDate(startDate) : undefined;
}

function MentionAccessories(props: {
  blockName: BlockName | BlockAlias;
  blockParams?: Record<string, string>;
}) {
  const accessories = () =>
    mentionsAccessories(props.blockName as BlockName, props.blockParams ?? {});
  return (
    <span class="relative text-[0.8em] text-current/50 rounded-xs">
      <Show when={accessories()}>
        {(value) => (
          <>
            {` ${value().note ?? ''}`}
            {getMentionsIcon(value().icon)}
          </>
        )}
      </Show>
    </span>
  );
}

export function InlinePreview(props: {
  previewData: ReturnType<typeof useItemPreviewData>;
  entity: ItemEntity;
  blockName: BlockName | BlockAlias;
  blockParams: Record<string, string>;
  theme?: EditorThemeClasses;
  collapsed?: boolean;
  documentName?: string;
  createdAt?: number;
  isRecentMention: () => boolean;
  onOpened?: () => void;
}) {
  const { item, ItemEntityIcon, documentProperties } = props.previewData;

  const shouldShowFallback = createMemo(() => {
    return (
      shouldUseFallbackForRecentMention(item(), props.isRecentMention()) &&
      props.documentName
    );
  });
  const isSkill = () => props.blockName === 'skill';

  return (
    <Switch>
      <Match when={item().loading}>
        <Show
          when={isSkill()}
          fallback={
            <MentionContainer
              icon={
                <Show
                  when={props.blockName === 'task'}
                  fallback={
                    <EntityIcon
                      targetType={props.blockName as any}
                      size="fill"
                      class="animate-pulse"
                    />
                  }
                >
                  <TaskStatusIcon size="fill" />
                </Show>
              }
              text={
                <span
                  data-document-mention="true"
                  data-document-id={props.entity.id}
                  data-block-name={props.blockName}
                  data-document-name={props.documentName}
                  class="opacity-50"
                >
                  <Show when={props.documentName} fallback="Loading...">
                    {(name) => name().replaceAll('\n', ' ').trim()}
                  </Show>
                  <MentionAccessories
                    blockName={props.blockName}
                    blockParams={props.blockParams}
                  />
                </span>
              }
              collapsed={props.collapsed}
            />
          }
        >
          <SkillSlashText
            documentId={props.entity.id}
            name={props.documentName ?? ''}
            collapsed={props.collapsed}
            dimmed
            onOpened={props.onOpened}
          />
        </Show>
      </Match>
      <Match when={shouldShowFallback()}>
        <Show
          when={isSkill()}
          fallback={
            <MentionContainer
              icon={
                <Show
                  when={props.blockName === 'task'}
                  fallback={
                    <EntityIcon
                      targetType={props.blockName as any}
                      size="fill"
                    />
                  }
                >
                  <TaskStatusIcon size="fill" />
                </Show>
              }
              text={
                <span
                  data-document-mention="true"
                  data-document-id={props.entity.id}
                  data-block-name={props.blockName}
                  data-document-name={props.documentName}
                >
                  <Show when={props.documentName} fallback="Unknown">
                    {(name) => name().replaceAll('\n', ' ').trim()}
                  </Show>
                  <MentionAccessories
                    blockName={props.blockName}
                    blockParams={props.blockParams}
                  />
                </span>
              }
              collapsed={props.collapsed}
            />
          }
        >
          <SkillSlashText
            documentId={props.entity.id}
            name={props.documentName ?? ''}
            collapsed={props.collapsed}
            onOpened={props.onOpened}
          />
        </Show>
      </Match>
      <Match when={matches(item(), isAccessiblePreviewItem)}>
        {(accessibleItem) => (
          <Show
            when={isSkill()}
            fallback={
              <MentionContainer
                icon={
                  <ItemEntityIcon
                    size="fill"
                    theme={
                      accessibleItem().type !== 'channel' &&
                      props.theme?.['document-mention'] === 'chat-blue'
                        ? 'monochrome'
                        : undefined
                    }
                  />
                }
                text={
                  <span
                    data-document-mention="true"
                    data-document-id={accessibleItem().id}
                    data-block-name={props.blockName}
                    data-document-name={accessibleItem().name}
                  >
                    {accessibleItem().name.replaceAll('\n', ' ').trim()}
                    <Show
                      when={
                        accessibleItem().type === 'call' &&
                        accessibleItem().updatedAt
                      }
                    >
                      {(timeStamp) => {
                        return (
                          <span class="text-current/50 text-[0.8em]">
                            {` ${formatDate(timeStamp(), { showTime: true })}`}
                          </span>
                        );
                      }}
                    </Show>
                    <Show when={matches(item(), isCalendarEventPreviewItem)}>
                      {(calendarItem) => (
                        <Show
                          when={calendarMentionTimeLabel(calendarItem().event)}
                        >
                          {(timeLabel) => (
                            <span class="text-current/50 text-[0.8em]">
                              {` ${timeLabel()}`}
                            </span>
                          )}
                        </Show>
                      )}
                    </Show>
                    <MentionAccessories
                      blockName={props.blockName}
                      blockParams={props.blockParams}
                    />
                    <Show when={props.blockName === 'task'}>
                      <Suspense>
                        <InlineTaskProperties
                          taskId={accessibleItem().id}
                          previewProperties={documentProperties()}
                        />
                      </Suspense>
                    </Show>
                  </span>
                }
                collapsed={props.collapsed}
              />
            }
          >
            <SkillSlashText
              documentId={accessibleItem().id}
              name={accessibleItem().name}
              collapsed={props.collapsed}
              onOpened={props.onOpened}
            />
          </Show>
        )}
      </Match>
      <Match when={(item() as PreviewItemNoAccess).access === 'no_access'}>
        <MentionContainer icon={<EyeSlashDuo />} text="No Access" />
      </Match>
      <Match when={(item() as PreviewItemNoAccess).access === 'does_not_exist'}>
        <MentionContainer icon={<TrashSimple />} text="Deleted" />
      </Match>
    </Switch>
  );
}

export function DocumentMention(props: DocumentMentionProps) {
  if (props.blockName === 'routine' || props.blockName === 'automation') {
    return <RoutineMention {...props} />;
  }
  const lexicalWrapper = useContext(LexicalWrapperContext);
  if (props.host?.skipPreviewFetch ?? lexicalWrapper?.skipPreviewFetch) {
    return <DocumentMentionStatic {...props} />;
  }
  // Only skill mentions need to distinguish built-ins from stored documents.
  // Ordinary mentions must not wait for a once-per-session skills request.
  return (
    <Switch
      fallback={
        <Suspense fallback={<DocumentMentionStatic {...props} />}>
          <DocumentMentionInner {...props} />
        </Suspense>
      }
    >
      <Match when={props.blockName === 'database'}>
        <DatabaseMention {...props} />
      </Match>
      <Match when={props.blockName === 'form'}>
        <FormMention {...props} />
      </Match>
      <Match when={props.blockName === 'skill'}>
        <SkillDocumentMention {...props} />
      </Match>
      <Match when={props.blockName === 'external_chat'}>
        <ExternalChatMention {...props} />
      </Match>
    </Switch>
  );
}

/** Whether a mention was made in the last minute; it stops being recent while mounted. */
export function createRecentMention(createdAt: number | undefined) {
  const recentForMs = createdAt
    ? createdAt + RECENT_MENTION_THRESHOLD_MS - Date.now()
    : 0;
  const [isRecent, setIsRecent] = createSignal(recentForMs > 0);
  if (recentForMs > 0) {
    const timer = setTimeout(() => setIsRecent(false), recentForMs);
    onCleanup(() => clearTimeout(timer));
  }
  return isRecent;
}

/**
 * A reference that opens its item on click or Enter: its icon and name in
 * the mention chip, without a document preview.
 */
function EntityMentionLink(props: {
  documentId: string;
  blockName: string;
  name: string;
  icon: JSX.Element;
  collapsed?: boolean;
  onOpen: (event: MouseEvent | KeyboardEvent) => void;
}) {
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onOpen(event);
  };
  return (
    <span
      class="rounded-xs hover:bg-hover focus-visible:outline-2 focus-visible:outline-ink/30"
      role="link"
      tabIndex={0}
      on:mousedown={(event) => event.preventDefault()}
      on:click={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter') open(event);
      }}
    >
      <MentionContainer
        icon={props.icon}
        collapsed={props.collapsed}
        text={
          <span
            data-document-mention="true"
            data-document-id={props.documentId}
            data-block-name={props.blockName}
            data-document-name={props.name}
          >
            {props.name}
          </span>
        }
      />
    </span>
  );
}

/** How an unavailable reference reads: `Deleted` or `No Access`. */
function UnavailableMentionChip(props: {
  access: PreviewItemNoAccess['access'];
  collapsed?: boolean;
}) {
  return (
    <Show
      when={props.access === 'no_access'}
      fallback={
        <MentionContainer
          icon={<TrashSimple />}
          text="Deleted"
          collapsed={props.collapsed}
        />
      }
    >
      <MentionContainer
        icon={<EyeSlashDuo />}
        text="No Access"
        collapsed={props.collapsed}
      />
    </Show>
  );
}

/**
 * A database, form or routine reference whose item is gone or hidden from the
 * viewer. It reads `Deleted` or `No Access` like any other unavailable
 * reference, and clicking it keeps the item's card open (a tap opens the card
 * as a sheet) instead of opening anything.
 */
function UnavailableMention(props: {
  access: PreviewItemNoAccess['access'];
  documentInfo: DocumentPreviewContentProps['documentInfo'];
  collapsed?: boolean;
}) {
  const [previewCardOpen, setPreviewCardOpen] = createSignal(false);
  const [previewSheetOpen, setPreviewSheetOpen] = createSignal(false);
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isTouchDevice()) setPreviewSheetOpen(true);
    else setPreviewCardOpen(true);
  };
  return (
    <>
      <Show when={isTouchDevice()}>
        <DocumentPreviewSheet
          open={previewSheetOpen()}
          onOpenChange={setPreviewSheetOpen}
          documentInfo={props.documentInfo}
        />
      </Show>
      <HoverCard
        open={previewCardOpen()}
        onOpenChange={setPreviewCardOpen}
        keepOpenOnTriggerPress
        trigger={
          <span
            class="rounded-xs hover:bg-hover focus-visible:outline-2 focus-visible:outline-ink/30"
            role="link"
            tabIndex={0}
            on:mousedown={(event) => event.preventDefault()}
            on:click={open}
            onKeyDown={(event) => {
              if (event.key === 'Enter') open(event);
            }}
          >
            <UnavailableMentionChip
              access={props.access}
              collapsed={props.collapsed}
            />
          </span>
        }
        content={
          <PopupPreview
            mouseEnter={() => {}}
            mouseLeave={() => {}}
            documentInfo={props.documentInfo}
          />
        }
      />
    </>
  );
}

/**
 * How a database or form reference reads once its detail read fails, or
 * nothing while it keeps the chip it loaded: a refetch that fails for any
 * reason but the item being gone leaves the loaded chip on screen.
 */
function detailUnavailable(detail: {
  isError: boolean;
  error: unknown;
  dataUpdatedAt: number;
}): PreviewItemNoAccess['access'] | undefined {
  if (!detail.isError) return undefined;
  const access =
    detail.error instanceof ThrownResultError
      ? failedReadAccess(detail.error.errors)
      : 'no_access';
  if (detail.dataUpdatedAt > 0 && access !== 'does_not_exist') return undefined;
  return access;
}

function RoutineMention(props: DocumentMentionProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  if (props.host?.skipPreviewFetch ?? lexicalWrapper?.skipPreviewFetch)
    return <RoutineLink {...props} />;
  return <PreviewedRoutineMention {...props} />;
}

function PreviewedRoutineMention(props: DocumentMentionProps) {
  const { item } = useItemPreviewData(() => ({
    id: props.documentId,
    type: 'routine',
  }));
  const isRecentMention = createRecentMention(props.createdAt);
  // A routine made in the last minute can briefly preview as missing; it
  // still opens rather than reading as deleted.
  const unavailable = () => {
    const i = item();
    if (i.loading || i.access === 'access') return undefined;
    if (i.access === 'does_not_exist' && isRecentMention()) return undefined;
    return i.access;
  };
  // A pasted routine link carries no label; name it from the routine's read.
  const resolvedName = () => {
    const i = item();
    if (i.loading || i.access !== 'access') return undefined;
    return i.name;
  };
  // Save that name on the node too, so the sent message carries it. Like a
  // label picked from the mention menu, it is kept from then on.
  const editor = useContext(LexicalWrapperContext)?.editor;
  createEffect(() => {
    const name = resolvedName()?.trim();
    if (!name || props.documentName) return;
    const documentId = props.documentId;
    setTimeout(() => {
      editor?.dispatchCommand(UPDATE_DOCUMENT_NAME_COMMAND, {
        [documentId]: name,
      });
    });
  });
  return (
    <Show
      when={unavailable()}
      fallback={<RoutineLink {...props} resolvedName={resolvedName()} />}
    >
      {(access) => (
        <UnavailableMention
          access={access()}
          collapsed={props.collapsed}
          documentInfo={{
            id: props.documentId,
            type: 'routine',
            params: {},
            isOpenable: true,
          }}
        />
      )}
    </Show>
  );
}

/**
 * Routine references use their saved label, else the routine's own name;
 * routines have no hover preview.
 */
function RoutineLink(props: DocumentMentionProps & { resolvedName?: string }) {
  const name = () =>
    props.documentName?.replaceAll('\n', ' ').trim() ||
    props.resolvedName?.replaceAll('\n', ' ').trim() ||
    'Routine';
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const result = openDocument(
      'routine',
      props.documentId,
      undefined,
      openInNewSplitForMention(event.shiftKey, true)
    );
    if (result && result.status !== 'unavailable') props.onOpened?.();
  };
  return (
    <Tooltip label={name()} as="span" disabled={!props.collapsed}>
      <span
        class="rounded-xs hover:bg-hover focus-visible:outline-2 focus-visible:outline-ink/30"
        role="link"
        aria-label={name()}
        tabIndex={0}
        on:mousedown={(event) => event.preventDefault()}
        on:click={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter') open(event);
        }}
      >
        <DocumentMentionStatic {...props} documentName={name()} />
      </span>
    </Tooltip>
  );
}

/** Databases have their own permission-checked metadata, not a document preview. */
function DatabaseMention(props: DocumentMentionProps) {
  const wrapper = useContext(LexicalWrapperContext);
  const host = props.host ?? createLexicalDocumentMentionHost(wrapper);
  const [editable, setEditable] = createSignal(host.isEditable());
  const release = host.registerEditableListener((value) => {
    setEditable(value);
  });
  if (release) onCleanup(release);
  const detail = useDatabaseDetailQuery(() => props.documentId);
  const name = () =>
    detail.isSuccess ? detail.data.database.name : props.documentName;
  const expand = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!host.isEditable() || !host.isInteractable()) return;
    host.convertToCard(props.key);
  };
  return (
    <Show
      when={detailUnavailable(detail)}
      fallback={
        <span class="inline-flex items-baseline gap-1">
          <EntityMentionLink
            documentId={props.documentId}
            blockName="database"
            name={name() || 'Database'}
            icon={
              <EntityIcon
                targetType="database"
                appearance={
                  detail.isSuccess ? detail.data.database.appearance : undefined
                }
                size="fill"
              />
            }
            collapsed={props.collapsed}
            onOpen={(event) => {
              const result = openDocument(
                'database',
                props.documentId,
                props.blockParams,
                openInNewSplitForMention(event.shiftKey, true)
              );
              if (result && result.status !== 'unavailable') props.onOpened?.();
            }}
          />
          <Show when={editable() && host.isInteractable()}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Expand database"
              tooltip="Expand database"
              on:mousedown={(event) => event.preventDefault()}
              on:click={expand}
            >
              <ArrowsOut class="size-3.5" />
            </Button>
          </Show>
        </span>
      }
    >
      {(access) => (
        <UnavailableMention
          access={access()}
          collapsed={props.collapsed}
          documentInfo={{
            id: props.documentId,
            type: 'database',
            params: props.blockParams ?? {},
            isOpenable: true,
          }}
        />
      )}
    </Show>
  );
}

/**
 * A form: its icon and name, from its own detail, which respondents can read.
 * Opens for every recipient; the forms flag gates authoring only.
 */
function FormMention(props: DocumentMentionProps) {
  const detail = useFormDetailQuery(() => props.documentId);
  const name = () =>
    detail.isSuccess ? detail.data.form.name : props.documentName;
  return (
    <Show
      when={detailUnavailable(detail)}
      fallback={
        <EntityMentionLink
          documentId={props.documentId}
          blockName="form"
          name={name() || 'Form'}
          icon={
            <EntityIcon
              targetType="form"
              appearance={
                detail.isSuccess ? detail.data.form.appearance : undefined
              }
              size="fill"
            />
          }
          collapsed={props.collapsed}
          onOpen={(event) => {
            const result = openDocument(
              'form',
              props.documentId,
              props.blockParams,
              openInNewSplitForMention(event.shiftKey, true)
            );
            if (result && result.status !== 'unavailable') props.onOpened?.();
          }}
        />
      }
    >
      {(access) => (
        <UnavailableMention
          access={access()}
          collapsed={props.collapsed}
          documentInfo={{
            id: props.documentId,
            type: 'form',
            params: props.blockParams ?? {},
            isOpenable: true,
          }}
        />
      )}
    </Show>
  );
}

/**
 * An external chat: not a previewable document, so it shows its name and opens
 * inside External; a viewer the chat isn't shared with sees it as
 * unavailable.
 */
function ExternalChatMention(props: DocumentMentionProps) {
  const { openWithSplit } = useSplitLayout();
  const userId = useUserId();
  const detail = useExternalChatDetailQuery(
    externalChatApi,
    () => userId() ?? '',
    () => props.documentId
  );
  const name = () => (detail.isSuccess ? detail.data.name : props.documentName);
  return (
    <Show
      when={detailUnavailable(detail)}
      fallback={
        <EntityMentionLink
          documentId={props.documentId}
          blockName="external_chat"
          name={name() || 'External chat'}
          icon={
            <EntityIcon
              targetType="external_chat"
              provider={detail.isSuccess ? detail.data.provider : undefined}
              size="fill"
            />
          }
          collapsed={props.collapsed}
          onOpen={(event) => {
            const result = openWithSplit(
              externalChatContent(props.documentId),
              {
                preferNewSplit: openInNewSplitForMention(event.shiftKey, true),
              }
            );
            if (result && result.status !== 'unavailable') props.onOpened?.();
          }}
        />
      }
    >
      {(access) => (
        <UnavailableMentionChip access={access()} collapsed={props.collapsed} />
      )}
    </Show>
  );
}

function SkillDocumentMention(props: DocumentMentionProps) {
  const systemSkills = useSystemSkillsQuery();
  return (
    <Switch>
      <Match when={systemSkills.getSystemSkill(props.documentId)}>
        {(skill) => <SystemSkillMention name={skill().name} {...props} />}
      </Match>
      {/* Until the (once-per-session) system skill list arrives, ids can't be
          classified — render from the stored name so a system skill never
          flashes the preview service's "Deleted" state. */}
      <Match when={systemSkills.query.isPending}>
        <DocumentMentionStatic {...props} />
      </Match>
      <Match when={true}>
        <Suspense fallback={<DocumentMentionStatic {...props} />}>
          <DocumentMentionInner {...props} />
        </Suspense>
      </Match>
    </Switch>
  );
}

/**
 * Mention pill for a built-in system skill. System skills are static strings
 * in code, not documents, so there is nothing to preview-fetch and nothing to
 * open — the pill never navigates.
 */
function SystemSkillMention(props: DocumentMentionProps & { name: string }) {
  return (
    <SkillSlashText
      documentId={props.documentId}
      name={props.name}
      collapsed={props.collapsed}
      onOpened={props.onOpened}
    />
  );
}

/** Lightweight mention display that skips all backend fetches. Uses only the stored name. */
export function DocumentMentionStatic(props: DocumentMentionProps) {
  if (props.blockName === 'skill') {
    return (
      <SkillSlashText
        documentId={props.documentId}
        name={props.documentName ?? ''}
        collapsed={props.collapsed}
        onOpened={props.onOpened}
      />
    );
  }
  return (
    <MentionContainer
      icon={
        <Show
          when={props.blockName === 'task'}
          fallback={
            <EntityIcon targetType={props.blockName as any} size="fill" />
          }
        >
          <TaskStatusIcon size="fill" />
        </Show>
      }
      collapsed={props.collapsed}
      text={
        <span
          data-document-mention="true"
          data-document-id={props.documentId}
          data-block-name={props.blockName}
          data-document-name={props.documentName}
        >
          {(props.documentName || 'Loading...').replaceAll('\n', ' ').trim()}
          <MentionAccessories
            blockName={verifyBlockName(props.blockName)}
            blockParams={props.blockParams}
          />
        </span>
      }
    />
  );
}
