import { describe, expect, it, vi } from 'vitest';
import { type MessageMenuActionId, messageMenuGroups } from './message-menu';

describe('messageMenuGroups', () => {
  it.each(['chat', 'ask-macro'] as const)(
    'orders desktop and phone actions with %s',
    (chatId) => {
      const onClick = vi.fn();
      const ids: MessageMenuActionId[] = [
        'delete',
        'copy-message-text',
        chatId,
        'edit',
        'reply',
        'copy-link',
        'create-task',
      ];
      const actions = ids.map((id) => ({ id, onClick }));
      const groups = messageMenuGroups(actions);
      expect(
        groups.map(({ id, items }) => [id, items.map((item) => item.id)])
      ).toEqual([
        ['most-used', ['reply', 'create-task', chatId]],
        ['copy', ['copy-link', 'copy-message-text']],
        ['modify', ['edit']],
        ['delete', ['delete']],
      ]);
      expect(groups.at(-1)?.items[0]).toBe(actions[0]);
      groups.at(-1)?.items[0].onClick();
      expect(onClick).toHaveBeenCalledOnce();
      expect(ids[0]).toBe('delete');
    }
  );

  it('omits actions without handlers and leaves a read-only message copyable', () => {
    const onClick = vi.fn();
    expect(
      messageMenuGroups([
        { id: 'delete', onClick: undefined },
        { id: 'copy-link', onClick },
        { id: 'edit', onClick: undefined },
        { id: 'reply', onClick: undefined },
      ])
    ).toEqual([{ id: 'copy', items: [{ id: 'copy-link', onClick }] }]);
    expect(messageMenuGroups([])).toEqual([]);
  });
});
