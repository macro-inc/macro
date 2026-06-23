import type { BlockAlias, BlockName } from '@core/block';
import { match } from 'ts-pattern';
import type {
  AutomationEntity,
  CallEntity,
  ChannelEntity,
  ChatEntity,
  DocumentEntity,
  EmailEntity,
  EntityData,
  ProjectEntity,
  SnippetEntity,
  TaskEntity,
} from '../types/entity';

export type BuildEntityDataArgs = {
  id: string;
  name: string;
  blockName: BlockName | BlockAlias;
  ownerId?: string;
  projectId?: string;
  fileType?: string;
  isCompleted?: boolean;
  channelType?: ChannelEntity['channelType'];
  cron?: string;
  enabled?: boolean;
  channelId?: string;
  isActive?: boolean;
  status?: CallEntity['status'];
  attended?: boolean;
  participantIds?: string[];
  isRead?: boolean;
  isDraft?: boolean;
  isImportant?: boolean;
  done?: boolean;
};

/**
 * Build a full `EntityData` from the simple shape that's typically
 * available at component level (id, name, blockName).
 *
 * The `blockName` discriminator is funneled into the right `EntityData`
 * variant: e.g. `'task'` becomes `{ type: 'document', fileType: 'md',
 * subType: { type: 'task' } }`, `'pdf'` becomes `{ type: 'document',
 * fileType: 'pdf' }`, etc.
 *
 * Returns `undefined` when required fields for the resolved variant are
 * missing (e.g. a `'channel'` without a `channelType`).
 */
export function buildEntityData(
  args: BuildEntityDataArgs
): EntityData | undefined {
  const { id, name, blockName, ownerId = '' } = args;
  if (!id || !name || !blockName) return undefined;

  const base = { id, name, ownerId };

  return (
    match<BlockName | BlockAlias, EntityData | undefined>(blockName)
      .with(
        'task',
        (): TaskEntity => ({
          ...base,
          type: 'document',
          fileType: 'md',
          subType: { type: 'task', is_completed: args.isCompleted ?? false },
          projectId: args.projectId,
        })
      )
      .with(
        'snippet',
        (): SnippetEntity => ({
          ...base,
          type: 'document',
          fileType: 'md',
          subType: { type: 'snippet' },
          projectId: args.projectId,
        })
      )
      .with(
        'md',
        (): DocumentEntity => ({
          ...base,
          type: 'document',
          fileType: 'md',
          projectId: args.projectId,
        })
      )
      .with(
        'pdf',
        'write',
        'code',
        'image',
        'canvas',
        'video',
        'unknown',
        'csv',
        (name): DocumentEntity => ({
          ...base,
          type: 'document',
          fileType: args.fileType ?? name,
          projectId: args.projectId,
        })
      )
      .with(
        'chat',
        (): ChatEntity => ({
          ...base,
          type: 'chat',
          projectId: args.projectId,
        })
      )
      .with(
        'project',
        (): ProjectEntity => ({
          ...base,
          type: 'project',
          projectId: args.projectId,
        })
      )
      .with('channel', (): ChannelEntity | undefined => {
        if (!args.channelType) return undefined;
        return {
          ...base,
          type: 'channel',
          channelType: args.channelType,
        };
      })
      .with(
        'email',
        (): EmailEntity => ({
          ...base,
          type: 'email',
          isRead: args.isRead ?? true,
          isDraft: args.isDraft ?? false,
          isImportant: args.isImportant ?? false,
          done: args.done ?? false,
        })
      )
      .with('automation', (): AutomationEntity | undefined => {
        if (!args.cron) return undefined;
        return {
          ...base,
          type: 'automation',
          cron: args.cron,
          enabled: args.enabled ?? false,
        };
      })
      .with('call', (): CallEntity | undefined => {
        if (!args.channelId) return undefined;
        const status: CallEntity['status'] =
          args.status ?? (args.attended ? 'ATTENDED' : 'UNATTENDED');

        return {
          ...base,
          type: 'call',
          channelId: args.channelId,
          isActive: args.isActive ?? false,
          status,
          attended: status === 'ATTENDED',
          participantIds: args.participantIds ?? [],
        };
      })
      // CRM companies/contacts aren't constructed from block args; soup is the source.
      .with('company', 'contact', (): undefined => undefined)
      // PRs are virtual blocks backed by GitHub, not Macro entities.
      .with('pr', (): undefined => undefined)
      .exhaustive()
  );
}
