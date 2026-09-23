import { calendarViewContent } from '@app/features/calendar-view/calendar-navigation';
import { createSearchParamsCodec } from '@app/lib/split-router';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import type { PreviewPanelSelection } from '@components/app/previewTarget';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import type { BlockName } from '@core/block';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
import { match } from 'ts-pattern';
import { z } from 'zod';
import type { InboxPreviewRouteParams } from './inbox-route-schema';

export const INBOX_PREVIEW_SEARCH_NAMESPACE = 'inbox-preview';

const previewSelectionTypes = [
  '',
  'agent_session',
  'automation',
  'call',
  'calendar_event',
  'channel',
  'channel_message',
  'channel_thread',
  'chat',
  'crm_company',
  'crm_contact',
  'document',
  'email',
  'foreign',
  'project',
  'reminder',
] as const;

const reminderReferenceTypes = [
  '',
  'agent_session',
  'automation',
  'call',
  'channel',
  'channel_message',
  'channel_thread',
  'chat',
  'crm_company',
  'crm_contact',
  'document',
  'email',
  'foreign',
  'project',
] as const;

const documentSubTypes = ['', 'task', 'snippet', 'skill'] as const;
const calendarTimeKinds = ['', 'timed', 'allDay'] as const;

export const inboxPreviewSearch = {
  namespace: INBOX_PREVIEW_SEARCH_NAMESPACE,
  schema: z.object({
    selectionType: z.enum(previewSelectionTypes),
    selectionId: z.string(),
    fileType: z.string(),
    subType: z.enum(documentSubTypes),
    foreignSource: z.enum(['', 'unknown', 'github_pull_request']),
    sourceMessageId: z.string(),
    sourceThreadId: z.string(),
    targetMessageId: z.string(),
    targetThreadId: z.string(),
    eventId: z.string(),
    occurrenceKey: z.string(),
    calendarTimeKind: z.enum(calendarTimeKinds),
    startsAt: z.string(),
    endsAt: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    reminderId: z.string(),
    referencedType: z.enum(reminderReferenceTypes),
    referencedFileType: z.string(),
    referencedSubType: z.string(),
  }),
  defaults: {
    selectionType: '' as const,
    selectionId: '',
    fileType: '',
    subType: '' as const,
    foreignSource: '' as const,
    sourceMessageId: '',
    sourceThreadId: '',
    targetMessageId: '',
    targetThreadId: '',
    eventId: '',
    occurrenceKey: '',
    calendarTimeKind: '' as const,
    startsAt: '',
    endsAt: '',
    startDate: '',
    endDate: '',
    reminderId: '',
    referencedType: '' as const,
    referencedFileType: '',
    referencedSubType: '',
  },
};

export type InboxPreviewSearchParams = z.infer<
  typeof inboxPreviewSearch.schema
>;

export const inboxPreviewSearchCodec =
  createSearchParamsCodec(inboxPreviewSearch);

function calendarTime(search: InboxPreviewSearchParams) {
  if (search.calendarTimeKind === 'timed' && search.startsAt && search.endsAt) {
    return {
      kind: 'timed' as const,
      startsAt: search.startsAt,
      endsAt: search.endsAt,
    };
  }
  if (
    search.calendarTimeKind === 'allDay' &&
    search.startDate &&
    search.endDate
  ) {
    return {
      kind: 'allDay' as const,
      startDate: search.startDate,
      endDate: search.endDate,
    };
  }
}

function fallbackSelection(
  params: InboxPreviewRouteParams
): PreviewPanelSelection | undefined {
  const id = params.previewId;
  return match(params.blockType)
    .returnType<PreviewPanelSelection | undefined>()
    .with('agent', () => ({ type: 'agent_session', id }))
    .with('automation', () => ({ type: 'automation', id }))
    .with('call', () => ({ type: 'call', id }))
    .with('calendar', () => ({ type: 'calendar_event', id }))
    .with('channel', () => ({ type: 'channel', id }))
    .with('chat', () => ({ type: 'chat', id }))
    .with('company', () => ({ type: 'crm_company', id }))
    .with('contact', () => ({ type: 'crm_contact', id }))
    .with('email', () => ({ type: 'email', id }))
    .with('project', () => ({ type: 'project', id }))
    .with('pr', () =>
      USE_MACRO_PR_SUMMARY_BLOCK
        ? ({
            type: 'foreign',
            id,
            foreignSource: 'github_pull_request',
          } as const)
        : undefined
    )
    .with(
      'canvas',
      'code',
      'image',
      'md',
      'pdf',
      'spreadsheet',
      'unknown',
      'video',
      (fileType) => ({ type: 'document', id, fileType })
    )
    .with('write', () => undefined)
    .exhaustive();
}

function selectionIdentity(selection: PreviewPanelSelection): {
  blockType: BlockName;
  id: string;
} {
  return match(selection)
    .returnType<{ blockType: BlockName; id: string }>()
    .with({ type: 'document' }, (document) => ({
      blockType: fileTypeToResolvedBlockName(document.fileType),
      id: document.id,
    }))
    .with(
      { type: 'channel_message' },
      { type: 'channel_thread' },
      (channel) => ({ blockType: 'channel', id: channel.channelId })
    )
    .with({ type: 'calendar_event' }, () => ({
      blockType: 'calendar',
      id: CALENDAR_BLOCK_ID,
    }))
    .with({ type: 'foreign' }, (foreign) => ({
      blockType:
        USE_MACRO_PR_SUMMARY_BLOCK &&
        foreign.foreignSource === 'github_pull_request'
          ? 'pr'
          : 'unknown',
      id: foreign.id,
    }))
    .with({ type: 'crm_company' }, (company) => ({
      blockType: 'company',
      id: company.id,
    }))
    .with({ type: 'crm_contact' }, (contact) => ({
      blockType: 'contact',
      id: contact.id,
    }))
    .with({ type: 'reminder' }, (reminder) => ({
      blockType: fileTypeToResolvedBlockName(
        reminder.referencedEntity?.subType ??
          reminder.referencedEntity?.fileType ??
          reminder.referencedEntity?.type
      ),
      id: reminder.referencedEntity?.id ?? reminder.id,
    }))
    .otherwise((selection) => ({
      blockType: fileTypeToResolvedBlockName(selection.type),
      id: selection.id,
    }));
}

function decodedSelection(
  params: InboxPreviewRouteParams,
  search: InboxPreviewSearchParams
): PreviewPanelSelection | undefined {
  const id = search.selectionId || params.previewId;
  const target = search.targetMessageId
    ? {
        messageId: search.targetMessageId,
        ...(search.targetThreadId ? { threadId: search.targetThreadId } : {}),
      }
    : undefined;

  return match(search.selectionType)
    .returnType<PreviewPanelSelection | undefined>()
    .with('', () => undefined)
    .with('document', () => ({
      type: 'document',
      id,
      ...(search.fileType ? { fileType: search.fileType } : {}),
      ...(search.subType
        ? {
            subType: {
              type: search.subType,
              ...(search.subType === 'task' ? { is_completed: false } : {}),
            },
          }
        : {}),
    }))
    .with('foreign', () => ({
      type: 'foreign',
      id,
      foreignSource: search.foreignSource || 'unknown',
    }))
    .with('channel', () => ({
      type: 'channel',
      id: params.previewId,
      ...(target ? { target } : {}),
    }))
    .with('channel_message', () => ({
      type: 'channel_message',
      id,
      channelId: params.previewId,
      messageId: search.sourceMessageId || search.targetMessageId || id,
      ...(search.sourceThreadId ? { threadId: search.sourceThreadId } : {}),
      ...(target ? { target } : {}),
    }))
    .with('channel_thread', () => ({
      type: 'channel_thread',
      id,
      channelId: params.previewId,
      messageId: search.sourceMessageId || search.targetMessageId || id,
      threadId:
        search.sourceThreadId ||
        search.targetThreadId ||
        search.sourceMessageId ||
        id,
      ...(target ? { target } : {}),
    }))
    .with('calendar_event', () => ({
      type: 'calendar_event',
      id: search.eventId || id,
      ...(search.occurrenceKey ? { occurrenceKey: search.occurrenceKey } : {}),
      ...(calendarTime(search) ? { time: calendarTime(search) } : {}),
    }))
    .with('reminder', () => ({
      type: 'reminder',
      id: search.reminderId || id,
      ...(search.referencedType
        ? {
            referencedEntity: {
              id: params.previewId,
              type: search.referencedType,
              ...(search.referencedFileType
                ? { fileType: search.referencedFileType }
                : {}),
              ...(search.referencedSubType
                ? { subType: search.referencedSubType }
                : {}),
            },
          }
        : {}),
    }))
    .with('agent_session', (type) => ({ type, id }))
    .with('automation', (type) => ({ type, id }))
    .with('call', (type) => ({ type, id }))
    .with('chat', (type) => ({ type, id }))
    .with('crm_company', (type) => ({ type, id }))
    .with('crm_contact', (type) => ({ type, id }))
    .with('email', (type) => ({ type, id }))
    .with('project', (type) => ({ type, id }))
    .exhaustive();
}

/** Rebuilds the minimal preview target from path identity plus typed search. */
export function inboxPreviewSelection(
  params: InboxPreviewRouteParams,
  search: InboxPreviewSearchParams
): PreviewPanelSelection | undefined {
  const decoded = decodedSelection(params, search);
  if (!decoded) return fallbackSelection(params);
  const identity = selectionIdentity(decoded);
  return identity.blockType === params.blockType &&
    identity.id === params.previewId
    ? decoded
    : fallbackSelection(params);
}

/** Full-block compatibility target for disabled or touch-only view surfaces. */
export function inboxPreviewLegacyTarget(
  params: InboxPreviewRouteParams,
  search: InboxPreviewSearchParams
): SplitContent {
  const documentSubType =
    search.selectionType === 'document'
      ? search.subType
      : search.selectionType === 'reminder'
        ? search.referencedSubType
        : '';
  if (
    params.blockType === 'md' &&
    (documentSubType === 'task' ||
      documentSubType === 'snippet' ||
      documentSubType === 'skill')
  ) {
    return { type: documentSubType, id: params.previewId };
  }
  if (params.blockType === 'channel' && search.targetMessageId) {
    return {
      type: 'channel',
      id: params.previewId,
      params: {
        [CHANNEL_URL_PARAMS.message]: search.targetMessageId,
        ...(search.targetThreadId
          ? { [CHANNEL_URL_PARAMS.thread]: search.targetThreadId }
          : {}),
      },
    };
  }
  if (params.blockType === 'calendar') {
    const range =
      search.startsAt && search.endsAt && search.startDate && search.endDate
        ? {
            start: search.startsAt,
            end: search.endsAt,
            startDate: search.startDate,
            endDate: search.endDate,
          }
        : undefined;
    return calendarViewContent({
      eventId: search.eventId || undefined,
      occurrenceKey: search.occurrenceKey || undefined,
      range,
    });
  }
  return { type: params.blockType, id: params.previewId };
}
