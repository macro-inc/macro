import {
  type CalendarPreviewSelection,
  type ChannelPreviewSelection,
  calendarBlockParamsForEntity,
  getChannelEntityTarget,
} from '@app/features/next-soup/utils';
import {
  type ReminderDetailDestination,
  reminderDetailDestination,
} from '@app/features/reminders/reminder-navigation';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { getChannelParams } from '@block-channel/utils/link';
import type {
  BlockAliasContext,
  BlockComponentProps,
  BlockName,
} from '@core/block';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
import type { DocumentEntity, ForeignEntity, ReminderEntity } from '@entity';
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

type ReminderPreviewSelection = Pick<ReminderEntity, 'id' | 'type'>;

export type PreviewPanelSelection =
  | IdOnlyPreviewSelection
  | DocumentPreviewSelection
  | ForeignPreviewSelection
  | ChannelPreviewSelection
  | CalendarPreviewSelection
  | ReminderPreviewSelection;

type PreviewBlockTarget = {
  kind: 'block';
  blockType: BlockName;
  blockId: string;
  aliasContext: BlockAliasContext | undefined;
  params?: BlockComponentProps[BlockName];
};

type PreviewReminderTarget = ReminderDetailDestination;

export type PreviewTarget = PreviewBlockTarget | PreviewReminderTarget;

export function previewTarget(entity: PreviewPanelSelection): PreviewTarget {
  return match(entity)
    .returnType<PreviewTarget>()
    .with(
      { type: 'document', fileType: 'md', subType: { type: 'task' } },
      (task) => ({
        kind: 'block',
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
        kind: 'block',
        blockType: fileTypeToResolvedBlockName(snippet.fileType),
        blockId: snippet.id,
        aliasContext: {
          alias: 'snippet',
          baseType: 'md',
        } satisfies BlockAliasContext,
      })
    )
    .with({ type: 'document' }, (document) => ({
      kind: 'block',
      blockType: fileTypeToResolvedBlockName(document.fileType),
      blockId: document.id,
      aliasContext: undefined,
    }))
    .with({ type: P.union('channel_message', 'channel_thread') }, (message) => {
      const channelTarget = untrack(() => getChannelEntityTarget(message));
      return {
        kind: 'block' as const,
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
      kind: 'block',
      blockType:
        USE_MACRO_PR_SUMMARY_BLOCK &&
        foreignEntity.foreignSource === 'github_pull_request'
          ? 'pr'
          : 'unknown',
      blockId: foreignEntity.id,
      aliasContext: undefined,
    }))
    .with({ type: 'crm_company' }, (company) => ({
      kind: 'block',
      blockType: 'company',
      blockId: company.id,
      aliasContext: undefined,
    }))
    .with({ type: 'crm_contact' }, (contact) => ({
      kind: 'block',
      blockType: 'contact',
      blockId: contact.id,
      aliasContext: undefined,
    }))
    .with({ type: 'calendar_event' }, (calendarEvent) => ({
      kind: 'block',
      blockType: 'calendar',
      blockId: CALENDAR_BLOCK_ID,
      aliasContext: undefined,
      params: untrack(() => calendarBlockParamsForEntity(calendarEvent)),
    }))
    .with({ type: 'reminder' }, (reminder) =>
      reminderDetailDestination(reminder.id)
    )
    .otherwise((fallbackEntity) => ({
      kind: 'block',
      blockType: fileTypeToResolvedBlockName(fallbackEntity.type),
      blockId: fallbackEntity.id,
      aliasContext: undefined,
    }));
}
