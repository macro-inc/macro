import {
  type CalendarPreviewSelection,
  type ChannelPreviewSelection,
  calendarViewTargetForEntity,
  getChannelEntityTarget,
  type ReminderPreviewSelection,
  reminderSplitTarget,
} from '@app/features/next-soup/utils';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { getChannelParams } from '@block-channel/utils/link';
import type {
  BlockAliasContext,
  BlockComponentProps,
  BlockName,
} from '@core/block';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
import type { DocumentEntity, ForeignEntity } from '@entity';
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
>;

type ForeignPreviewSelection = Pick<
  ForeignEntity,
  'id' | 'type' | 'foreignSource'
>;

export type PreviewPanelSelection =
  | IdOnlyPreviewSelection
  | DocumentPreviewSelection
  | ForeignPreviewSelection
  | ChannelPreviewSelection
  | CalendarPreviewSelection
  | ReminderPreviewSelection;

type PreviewBlockTarget = {
  blockType: BlockName;
  blockId: string;
  aliasContext: BlockAliasContext | undefined;
  params?: BlockComponentProps[BlockName];
};

export function previewBlockTarget(
  entity: PreviewPanelSelection
): PreviewBlockTarget {
  return match(entity)
    .returnType<PreviewBlockTarget>()
    .with(
      { type: 'document', fileType: 'md', subType: { type: 'task' } },
      (task) => ({
        blockType: fileTypeToResolvedBlockName(task.fileType),
        blockId: task.id,
        aliasContext: {
          alias: 'task',
          baseType: 'md',
        } satisfies BlockAliasContext,
      })
    )
    .with(
      { type: 'document', fileType: 'md', subType: { type: 'snippet' } },
      (snippet) => ({
        blockType: fileTypeToResolvedBlockName(snippet.fileType),
        blockId: snippet.id,
        aliasContext: {
          alias: 'snippet',
          baseType: 'md',
        } satisfies BlockAliasContext,
      })
    )
    .with({ type: 'document' }, (document) => ({
      blockType: fileTypeToResolvedBlockName(document.fileType),
      blockId: document.id,
      aliasContext: undefined,
    }))
    .with({ type: P.union('channel_message', 'channel_thread') }, (message) => {
      const channelTarget = untrack(() => getChannelEntityTarget(message));
      return {
        blockType: 'channel',
        blockId: message.channelId,
        aliasContext: undefined,
        params:
          channelTarget?.kind === 'message'
            ? getChannelParams(channelTarget.messageId, channelTarget.threadId)
            : undefined,
      };
    })
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
    .with({ type: 'calendar_event' }, (calendarEvent) => ({
      blockType: 'calendar',
      blockId: CALENDAR_BLOCK_ID,
      aliasContext: undefined,
      params: untrack(() => calendarViewTargetForEntity(calendarEvent)),
    }))
    .with({ type: 'reminder' }, (reminder) => {
      const reminderTarget = reminderSplitTarget(reminder);
      return {
        blockType: fileTypeToResolvedBlockName(reminderTarget?.type),
        blockId: reminderTarget?.id ?? reminder.id,
        aliasContext: undefined,
      };
    })
    .otherwise((fallbackEntity) => ({
      blockType: fileTypeToResolvedBlockName(fallbackEntity.type),
      blockId: fallbackEntity.id,
      aliasContext: undefined,
    }));
}
