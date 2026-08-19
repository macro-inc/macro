import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutate = vi.fn();
const layout = {
  revision: 2,
  categories: [
    { id: 'work', name: 'Work' },
    { id: 'empty', name: 'Empty' },
  ],
  placements: [
    { channel_id: 'one', category_id: 'work' },
    { channel_id: 'two', category_id: null },
  ],
};

vi.mock('@queries/channel/categories', () => ({
  useChannelCategoryLayoutQuery: () => ({ data: layout, isSuccess: true }),
  useReplaceChannelCategoryLayoutMutation: () => ({ mutate }),
}));

vi.mock('@thisbeyond/solid-dnd', () => ({
  createDraggable: () => ({ ref: vi.fn() }),
  createDroppable: () => ({ ref: vi.fn(), isActiveDroppable: false }),
  useDragDropContext: () => [undefined, { onDragEnd: vi.fn() }],
}));

import {
  ChannelCategoryControls,
  ChannelCategoryRowDnd,
  ChannelCategorySectionsBefore,
  ChannelCategoryTrailingSections,
} from './channel-category-controls';

describe('channel category UI', () => {
  beforeEach(() => {
    mutate.mockClear();
    layout.categories = [
      { id: 'work', name: 'Work' },
      { id: 'empty', name: 'Empty' },
    ];
  });

  it('renders real category, Uncategorized, and empty-category states', () => {
    render(() => (
      <>
        <ChannelCategoryControls />
        <ChannelCategorySectionsBefore channelId="one" />
        <ChannelCategoryTrailingSections lastChannelId="one" />
      </>
    ));
    expect(
      screen.getByRole('button', { name: /Work category, 1 channels/ })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Uncategorized category, 1 channels/ })
    ).toBeTruthy();
    expect(
      screen.getByRole('region', { name: /Empty category, 0 channels/ })
        .textContent
    ).toContain('No channels');
  });

  it('renders empty, populated, empty, and Uncategorized in exact persisted order', () => {
    layout.categories = [
      { id: 'empty-before', name: 'Empty before' },
      { id: 'work', name: 'Work' },
      { id: 'empty-after', name: 'Empty after' },
    ];
    render(() => (
      <main>
        <ChannelCategorySectionsBefore channelId="one" />
        <div>General row</div>
        <ChannelCategorySectionsBefore
          channelId="two"
          previousChannelId="one"
        />
        <div>Random row</div>
        <ChannelCategoryTrailingSections lastChannelId="two" />
      </main>
    ));
    expect(screen.getByRole('main').textContent).toBe(
      'Empty beforeNo channelsWorkGeneral rowEmpty afterNo channelsUncategorizedRandom row'
    );
  });

  it('persists keyboard-operable category and channel reordering', () => {
    render(() => (
      <>
        <ChannelCategoryControls />
        <ChannelCategoryRowDnd channelId="one" channelName="General">
          <span>General row</span>
        </ChannelCategoryRowDnd>
      </>
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Move Work category right' })
    );
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Move General to Empty' }),
      { key: 'Enter' }
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Move General down within/ })
    );
    expect(mutate).toHaveBeenCalledWith({
      type: 'move-category',
      categoryId: 'work',
      targetIndex: 1,
    });
    expect(mutate).toHaveBeenCalledWith({
      type: 'move-channel',
      channelId: 'one',
      categoryId: 'empty',
    });
    expect(mutate).toHaveBeenCalledWith({
      type: 'move-channel',
      channelId: 'one',
      categoryId: 'work',
      targetIndex: 1,
    });
  });

  it('requires confirmation before deleting a category', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(() => <ChannelCategoryControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Work' }));
    expect(mutate).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Work' }));
    expect(mutate).toHaveBeenCalledWith({
      type: 'delete-category',
      categoryId: 'work',
    });
    confirm.mockRestore();
  });
});
