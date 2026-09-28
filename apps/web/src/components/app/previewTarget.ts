import type { CalendarViewTarget } from '@app/features/calendar-view/types';
import {
  type CalendarPreviewSelection,
  type ChannelPreviewSelection,
  calendarViewTargetForEntity,
  getChannelEntityTarget,
  getDocumentCommentTarget,
  type ReminderPreviewSelection,
  reminderSplitTarget,
} from '@app/features/next-soup/utils';
import { getChannelParams } from '@block-channel/utils/link';
import type {
  BlockAliasContext,
  BlockComponentProps,
  BlockName,
} from '@core/block';
import {
  fileTypeToResolvedBlockName,
  isBlockAlias,
  resolveBlockAlias,
} from '@core/constant/allBlocks';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
import type {
  DocumentCommentTarget,
  DocumentEntity,
  ForeignEntity,
} from '@entity';
import { untrack } from 'solid-js';
import { match, P } from 'ts-pattern';

type IdOnlyPreviewSelection = {
  id: string;
  type:
    | 'agent_session'
    | 'automation'
    | 'call'
    | 'chat'
    | 'crm_company'
    | 'crm_contact'
    | 'email'
    | 'project';
};

type DocumentPreviewSelection = Pick<
  DocumentEntity,
  'id' | 'type' | 'fileType' | 'subType'
> & { commentTarget?: DocumentCommentTarget };

type ForeignPreviewSelection = Pick<
  ForeignEntity,
  'id' | 'type' | 'foreignSource'
>;

/** Selections that render inline through a block. */
export type PreviewPanelSelection =
  | IdOnlyPreviewSelection
  | DocumentPreviewSelection
  | ForeignPreviewSelection
  | ChannelPreviewSelection
  | ReminderPreviewSelection;

/** What a list row may ask to preview: a block inline, or the Calendar view. */
export type PreviewSelection = PreviewPanelSelection | CalendarPreviewSelection;

/** The block a selection opens, plus the params that load or locate its content. */
export type PreviewBlockTarget = {
  blockType: BlockName;
  blockId: string;
  aliasContext: BlockAliasContext | undefined;
  params?: BlockComponentProps[BlockName];
};

const documentCommentParams = (document: DocumentPreviewSelection) =>
  untrack(() => getDocumentCommentTarget(document)?.params);

function aliasContextFor(
  kind: string | undefined
): BlockAliasContext | undefined {
  if (kind === undefined || !isBlockAlias(kind)) return;
  return { alias: kind, baseType: resolveBlockAlias(kind) };
}

export function previewBlockTarget(
  entity: PreviewPanelSelection
): PreviewBlockTarget {
  return match(entity)
    .returnType<PreviewBlockTarget>()
    .with({ type: 'document' }, (document) => ({
      blockType: fileTypeToResolvedBlockName(document.fileType),
      blockId: document.id,
      aliasContext: aliasContextFor(document.subType?.type),
      params: documentCommentParams(document),
    }))
    .with(
      { type: P.union('channel', 'channel_message', 'channel_thread') },
      (channel) => {
        const target = untrack(() => getChannelEntityTarget(channel));
        return {
          blockType: 'channel',
          blockId: channel.type === 'channel' ? channel.id : channel.channelId,
          aliasContext: undefined,
          params:
            target?.kind === 'message'
              ? getChannelParams(target.messageId, target.threadId)
              : undefined,
        };
      }
    )
    .with({ type: 'foreign' }, (foreignEntity) => ({
      blockType:
        USE_MACRO_PR_SUMMARY_BLOCK &&
        foreignEntity.foreignSource === 'github_pull_request'
          ? 'pr'
          : 'unknown',
      blockId: foreignEntity.id,
      aliasContext: undefined,
    }))
    .with({ type: 'crm_company' }, (company) => ({
      blockType: 'company',
      blockId: company.id,
      aliasContext: undefined,
    }))
    .with({ type: 'crm_contact' }, (contact) => ({
      blockType: 'contact',
      blockId: contact.id,
      aliasContext: undefined,
    }))
    .with({ type: 'reminder' }, (reminder) => {
      const reminderTarget = reminderSplitTarget(reminder);
      return {
        blockType: fileTypeToResolvedBlockName(reminderTarget?.type),
        blockId: reminderTarget?.id ?? reminder.id,
        aliasContext: aliasContextFor(reminderTarget?.type),
      };
    })
    .otherwise((fallbackEntity) => ({
      blockType: fileTypeToResolvedBlockName(fallbackEntity.type),
      blockId: fallbackEntity.id,
      aliasContext: undefined,
    }));
}

/** Calendar events aim the Calendar view instead of mounting a block. */
export function previewCalendarTarget(
  entity: CalendarPreviewSelection
): CalendarViewTarget {
  return untrack(() => calendarViewTargetForEntity(entity));
}
