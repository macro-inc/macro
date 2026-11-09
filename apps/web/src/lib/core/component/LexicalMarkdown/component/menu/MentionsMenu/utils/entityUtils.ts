import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { EntityItem } from '@core/context/quickAccess';
import { match } from 'ts-pattern';
import type { MentionItem } from '../../../../utils/mentionsUtils';

/**
 * Get the block name from an entity item for use in mentions.
 */
export function getBlockNameFromEntity(
  item: EntityItem
): BlockName | BlockAlias {
  return match(item.bucket)
    .with('channel', () => 'channel' as const)
    .with('dm', () => 'channel' as const)
    .with('email', () => 'email' as const)
    .with('agent_session', () => 'agent' as const)
    .with('chat', () => 'chat' as const)
    .with('project', () => 'project' as const)
    .with('task', () => 'task' as const)
    .with('snippet', () => 'snippet' as const)
    .with('skill', () => 'skill' as const)
    .with('note', () => 'md' as const)
    .with('crm_company', () => 'company' as const)
    .with('crm_contact', () => 'contact' as const)
    .with('database', () => 'database' as const)
    .with('form', () => 'form' as const)
    .with('initiative', () => 'initiative' as const)
    .otherwise(() => {
      const entity = item.data;
      if ('fileType' in entity && typeof entity.fileType === 'string') {
        return fileTypeToBlockName(entity.fileType);
      }
      return 'unknown';
    });
}

/**
 * Get display name for a MentionItem.
 */
export function getMentionItemName(item: MentionItem): string {
  switch (item.kind) {
    case 'user': {
      const { email, name } = item.data;
      if (name === email) return email;
      return `${name} ${email}`;
    }
    case 'group':
      return `@${item.data.groupAlias}`;
    case 'date':
      return item.data.displayText;
    case 'agentSession':
      return [
        item.data.name || 'Agent session',
        item.data.bot?.name ? `@${item.data.bot.name}` : undefined,
      ]
        .filter(Boolean)
        .join(' ');
    case 'bookingLink':
    case 'calendarEvent':
      return item.data.title;
    case 'entity':
      return item.data.name ?? (item.bucket === 'email' ? 'No Subject' : '');
    case 'externalChat':
    case 'routine':
      return item.data.name;
  }
}

export function getMentionItemLabelParts(item: MentionItem) {
  return match(item)
    .with({ kind: 'user' }, ({ data: { name, email } }) => ({
      name: name || email,
      detail: name && name !== email ? email : undefined,
    }))
    .with({ kind: 'entity', data: { type: 'crm_contact' } }, ({ data }) => ({
      name: data.name || data.email,
      detail: data.name && data.name !== data.email ? data.email : undefined,
    }))
    .with({ kind: 'agentSession' }, ({ data }) => ({
      name: data.name || 'Agent session',
      detail: data.bot?.name ? `@${data.bot.name}` : undefined,
    }))
    .with({ kind: 'bookingLink' }, ({ data }) => ({
      name: data.title,
      detail: `${data.durationMinutes} min · ${data.owner}`,
    }))
    .with({ kind: 'calendarEvent' }, ({ data }) => ({
      name: data.title,
      detail: data.when,
    }))
    .otherwise(() => ({ name: getMentionItemName(item), detail: undefined }));
}
