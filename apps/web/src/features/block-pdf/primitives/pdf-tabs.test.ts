import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createPdfTabs, type PdfTabs } from './pdf-tabs';

function setup(): {
  tabs: PdfTabs;
  dispose: () => void;
} {
  return createRoot((dispose) => ({
    tabs: createPdfTabs(),
    dispose,
  }));
}

describe('createPdfTabs', () => {
  it('starts with one hidden active tab', () => {
    const { tabs, dispose } = setup();

    expect({
      items: tabs.items,
      activeId: tabs.activeId(),
      isVisible: tabs.isVisible(),
      count: tabs.count(),
    }).toEqual({
      items: [{ id: 0, label: 'Page 1', locationHash: '#page=1' }],
      activeId: 0,
      isVisible: false,
      count: 1,
    });
    dispose();
  });

  it('creates monotonically numbered tabs and controls visibility', () => {
    const { tabs, dispose } = setup();

    const firstId = tabs.commands.create({
      label: 'Page 2',
      locationHash: '#page=2',
    });
    const secondId = tabs.commands.create({
      label: 'Page 3',
      locationHash: '#page=3',
    });
    tabs.commands.remove(secondId);
    const thirdId = tabs.commands.create({
      label: 'Page 4',
      locationHash: '#page=4',
    });

    expect({
      ids: tabs.items.map((tab) => tab.id),
      createdIds: [firstId, secondId, thirdId],
      isVisible: tabs.isVisible(),
      count: tabs.count(),
    }).toEqual({
      ids: [0, 1, 3],
      createdIds: [1, 2, 3],
      isVisible: true,
      count: 3,
    });

    tabs.commands.toggleVisibility();
    expect(tabs.isVisible()).toBe(false);
    dispose();
  });

  it('owns activation history, metadata updates, and removal targets', () => {
    const { tabs, dispose } = setup();
    const firstId = tabs.commands.create({
      label: 'Page 2',
      locationHash: '#page=2',
    });
    const secondId = tabs.commands.create({
      label: 'Page 3',
      locationHash: '#page=3',
    });

    expect(tabs.commands.activate(firstId)).toBe(true);
    expect(tabs.commands.activate(99)).toBe(false);
    tabs.commands.updateCurrent({
      label: 'Page 4',
      locationHash: '#page=4',
    });
    tabs.commands.updateCurrent({
      label: 'Page 5',
      locationHash: '',
    });

    expect(tabs.items.find((tab) => tab.id === firstId)).toEqual({
      id: firstId,
      label: 'Page 5',
      locationHash: '#page=4',
    });

    expect(tabs.commands.activate(secondId)).toBe(true);
    expect(tabs.commands.remove(secondId)).toBe(firstId);
    expect(tabs.commands.activate(firstId)).toBe(true);
    expect(tabs.commands.remove(firstId)).toBe(0);
    expect(tabs.items).toEqual([
      { id: 0, label: 'Page 1', locationHash: '#page=1' },
    ]);
    dispose();
  });

  it('falls back to the first remaining tab when history is removed', () => {
    const { tabs, dispose } = setup();
    const firstId = tabs.commands.create({
      label: 'Page 2',
      locationHash: '#page=2',
    });
    tabs.commands.create({
      label: 'Page 3',
      locationHash: '#page=3',
    });

    expect(tabs.commands.remove(0)).toBe(firstId);
    expect(tabs.items.map((tab) => tab.id)).toEqual([1, 2]);
    dispose();
  });

  it('isolates tab authorities', () => {
    const first = setup();
    const second = setup();

    first.tabs.commands.create({
      label: 'Page 2',
      locationHash: '#page=2',
    });
    first.tabs.commands.activate(1);

    expect({
      firstCount: first.tabs.count(),
      firstActiveId: first.tabs.activeId(),
      secondCount: second.tabs.count(),
      secondActiveId: second.tabs.activeId(),
      secondVisible: second.tabs.isVisible(),
    }).toEqual({
      firstCount: 2,
      firstActiveId: 1,
      secondCount: 1,
      secondActiveId: 0,
      secondVisible: false,
    });
    first.dispose();
    second.dispose();
  });
});
