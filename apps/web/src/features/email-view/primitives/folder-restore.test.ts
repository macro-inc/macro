import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createListController } from '../../../components/list/create-list-controller';
import type { EmailTab } from '../tabs';
import { createEmailFolderRestore } from './folder-restore';

describe('folder restore selection lifetime', () => {
  it.each([
    'new selection',
    'switch folder',
    'reselect same row',
    'refresh rows',
    'unchanged',
  ])('handles %s during a pending restore', async (change) => {
    let dispose = () => {};
    const setup = createRoot((cleanup) => {
      dispose = cleanup;
      const [tab, setTab] = createSignal<EmailTab>('spam');
      const [items, setItems] = createSignal(['first', 'second']);
      const list = createListController({ items, getKey: (id) => id });
      list.selection.select('first');
      const pending = Promise.withResolvers<{ failedIds: string[] }>();
      const restore = vi.fn(() => pending.promise);
      const onRestored = vi.fn();
      const onFailed = vi.fn();
      const run = createEmailFolderRestore({
        tab,
        isPending: () => false,
        selection: list.selection.requestedKeys,
        clearSelection: list.selection.clear,
        restore,
        onRestored,
        onFailed,
      });
      return {
        setTab,
        setItems,
        list,
        pending,
        restore,
        onRestored,
        onFailed,
        run,
      };
    });
    try {
      const completion = setup.run(['first']);
      if (change === 'new selection') setup.list.selection.select('second');
      if (change === 'switch folder') {
        setup.setTab('trash');
        setup.list.selection.clear();
        setup.list.selection.select('second');
      }
      if (change === 'reselect same row') {
        setup.list.selection.clear();
        setup.list.selection.select('first');
      }
      if (change === 'refresh rows') setup.setItems([]);
      const beforeCompletion = [...setup.list.selection.requestedKeys()];
      setup.pending.resolve({ failedIds: [] });
      await completion;
      expect(setup.restore).toHaveBeenCalledExactlyOnceWith({
        folder: 'spam',
        threadIds: ['first'],
      });
      expect([...setup.list.selection.requestedKeys()]).toEqual(
        change === 'unchanged' || change === 'refresh rows'
          ? []
          : beforeCompletion
      );
      expect(setup.onRestored).toHaveBeenCalledOnce();
      expect(setup.onFailed).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it.each(['partial', 'rejected'])(
    'preserves selection after %s failure',
    async (outcome) => {
      let dispose = () => {};
      const setup = createRoot((cleanup) => {
        dispose = cleanup;
        const list = createListController({
          items: () => ['first'],
          getKey: (id) => id,
        });
        list.selection.select('first');
        const onFailed = vi.fn();
        const onRestored = vi.fn();
        const run = createEmailFolderRestore({
          tab: () => 'trash',
          isPending: () => false,
          selection: list.selection.requestedKeys,
          clearSelection: list.selection.clear,
          restore: async () => {
            if (outcome === 'rejected') throw new Error('Unavailable');
            return { failedIds: ['first'] };
          },
          onFailed,
          onRestored,
        });
        return { list, run, onFailed, onRestored };
      });
      try {
        await setup.run(['first']);
        expect([...setup.list.selection.requestedKeys()]).toEqual(['first']);
        expect(setup.onFailed).toHaveBeenCalledExactlyOnceWith(1);
        expect(setup.onRestored).not.toHaveBeenCalled();
      } finally {
        dispose();
      }
    }
  );
});
