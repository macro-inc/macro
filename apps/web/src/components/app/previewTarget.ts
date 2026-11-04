import type { CalendarViewTarget } from '@app/features/calendar-view/types';
import {
  type CalendarPreviewSelection,
  type ChannelPreviewSelection,
  calendarViewTargetForEntity,
  getChannelEntityTarget,
  getDocumentCommentTarget,
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
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import type {
  DocumentCommentTarget,
  DocumentEntity,
  ForeignEntity,
} from '@entity';
import type { WithNotification } from '@entity/types/notification';
import { newestRowNotification } from '@notifications/row-notification';
import { untrack } from 'solid-js';
import { match, P } from 'ts-pattern';

type IdOnlyPreviewSelection = {
  id: string;
  type:
    | 'agent_session'
    | 'routine'
    | 'call'
    | 'chat'
    | 'crm_company'
    | 'crm_contact'
    | 'database'
    | 'form'
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
  | WithNotification<{ type: 'initiative'; id: string }>
  | DocumentPreviewSelection
  | ForeignPreviewSelection
  | ChannelPreviewSelection;

/** What a list row may ask to preview: a block or a feature-owned detail view. */
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

/** A company or contact opens at the comment its notification is about. */
const crmCommentParams = (record: PreviewPanelSelection) => {
  const metadata = untrack(() =>
    newestRowNotification(record)
  )?.notification_metadata;
  return metadata?.tag === 'crm_discussion'
    ? { [COMMENT_LINK_PARAM]: metadata.content.messageId }
    : undefined;
};

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
    .with({ type: 'initiative' }, (project) => {
      const notification = untrack(() => newestRowNotification(project));
      const metadata = notification?.notification_metadata;
      return {
        blockType: 'initiative',
        blockId: project.id,
        aliasContext: undefined,
        params: {
          section: 'overview',
          ...(metadata?.tag === 'initiative_discussion'
            ? { discussionId: metadata.content.messageId }
            : {}),
        },
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
      params: crmCommentParams(company),
    }))
    .with({ type: 'crm_contact' }, (contact) => ({
      blockType: 'contact',
      blockId: contact.id,
      aliasContext: undefined,
      params: crmCommentParams(contact),
    }))
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
