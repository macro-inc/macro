import { globalSplitManager } from '@app/signal/splitLayout';

export function getOpenEntitiesPrompt(currentChatId?: string): string | null {
  const manager = globalSplitManager();
  if (!manager) return null;

  const splits = manager.splits();
  const items: string[] = [];
  for (const split of splits) {
    if (split.content.type === 'component') continue;
    if (split.content.type === 'chat' && split.content.id === currentChatId) {
      continue;
    }
    const handle = manager.getSplit(split.id);
    const name = handle?.displayName();
    const type = split.content.type;
    if (name) {
      items.push(`- ${name} (${type}, id: ${split.content.id})`);
    } else {
      items.push(`- ${type} (id: ${split.content.id})`);
    }
  }
  if (items.length === 0) return null;
  return `\nThe user currently has the following items open:\n${items.join('\n')}`;
}
