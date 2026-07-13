import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createSelectionState } from './selection-state';

type Item = { id: string; name: string };

const getItemId = (item: Item) => item.id;

const item1: Item = { id: '1', name: 'Item 1' };
const item2: Item = { id: '2', name: 'Item 2' };
const item3: Item = { id: '3', name: 'Item 3' };

describe('createSelectionState', () => {
  describe('initial state', () => {
    it('should start with empty selection', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({ getItemId });

        expect(selection.selected()).toEqual([]);
        expect(selection.selectedIds()).toEqual(new Set());
        expect(selection.count()).toBe(0);

        dispose();
      });
    });

    it('should accept initial items', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({
          getItemId,
          initial: [item1, item2],
        });

        expect(selection.selected()).toEqual([item1, item2]);
        expect(selection.selectedIds()).toEqual(new Set(['1', '2']));
        expect(selection.count()).toBe(2);

        dispose();
      });
    });
  });

  describe('select', () => {
    it('should add item to selection', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({ getItemId });

        selection.select(item1);

        expect(selection.selected()).toEqual([item1]);
        expect(selection.isSelected('1')).toBe(true);
        expect(selection.count()).toBe(1);

        dispose();
      });
    });

    it('should not duplicate already selected item', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({ getItemId });

        selection.select(item1);
        selection.select(item1);

        expect(selection.count()).toBe(1);

        dispose();
      });
    });
  });

  describe('deselect', () => {
    it('should remove item from selection', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({
          getItemId,
          initial: [item1, item2],
        });

        selection.deselect('1');

        expect(selection.selected()).toEqual([item2]);
        expect(selection.isSelected('1')).toBe(false);
        expect(selection.count()).toBe(1);

        dispose();
      });
    });

    it('should do nothing if item not selected', () => {
      createRoot((dispose) => {
        const onChange = vi.fn();
        const selection = createSelectionState({ getItemId, onChange });

        selection.deselect('nonexistent');

        expect(onChange).not.toHaveBeenCalled();

        dispose();
      });
    });
  });

  describe('toggle', () => {
    it('should select unselected item', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({ getItemId });

        selection.toggle(item1);

        expect(selection.isSelected('1')).toBe(true);

        dispose();
      });
    });

    it('should deselect selected item', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({
          getItemId,
          initial: [item1],
        });

        selection.toggle(item1);

        expect(selection.isSelected('1')).toBe(false);

        dispose();
      });
    });
  });

  describe('selectRange', () => {
    it('should add multiple items to selection', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({
          getItemId,
          initial: [item1],
        });

        selection.selectRange([item2, item3]);

        expect(selection.selected()).toEqual([item1, item2, item3]);
        expect(selection.count()).toBe(3);

        dispose();
      });
    });

    it('should not duplicate existing items', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({
          getItemId,
          initial: [item1],
        });

        selection.selectRange([item1, item2]);

        expect(selection.count()).toBe(2);

        dispose();
      });
    });

    it('should not trigger onChange if no new items added', () => {
      createRoot((dispose) => {
        const onChange = vi.fn();
        const selection = createSelectionState({
          getItemId,
          initial: [item1, item2],
          onChange,
        });

        onChange.mockClear();
        selection.selectRange([item1, item2]);

        expect(onChange).not.toHaveBeenCalled();

        dispose();
      });
    });
  });

  describe('set', () => {
    it('should replace entire selection', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({
          getItemId,
          initial: [item1, item2],
        });

        selection.set([item3]);

        expect(selection.selected()).toEqual([item3]);
        expect(selection.count()).toBe(1);

        dispose();
      });
    });
  });

  describe('clear', () => {
    it('should remove all items', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({
          getItemId,
          initial: [item1, item2],
        });

        selection.clear();

        expect(selection.selected()).toEqual([]);
        expect(selection.count()).toBe(0);

        dispose();
      });
    });

    it('should not trigger onChange if already empty', () => {
      createRoot((dispose) => {
        const onChange = vi.fn();
        const selection = createSelectionState({ getItemId, onChange });

        selection.clear();

        expect(onChange).not.toHaveBeenCalled();

        dispose();
      });
    });
  });

  describe('get', () => {
    it('should return item by id', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({
          getItemId,
          initial: [item1, item2],
        });

        expect(selection.get('1')).toBe(item1);
        expect(selection.get('2')).toBe(item2);

        dispose();
      });
    });

    it('should return undefined for non-selected id', () => {
      createRoot((dispose) => {
        const selection = createSelectionState({ getItemId });

        expect(selection.get('nonexistent')).toBeUndefined();

        dispose();
      });
    });
  });

  describe('onChange callback', () => {
    it('should be called on select', () => {
      createRoot((dispose) => {
        const onChange = vi.fn();
        const selection = createSelectionState({ getItemId, onChange });

        selection.select(item1);

        expect(onChange).toHaveBeenCalledWith([item1]);

        dispose();
      });
    });

    it('should be called on deselect', () => {
      createRoot((dispose) => {
        const onChange = vi.fn();
        const selection = createSelectionState({
          getItemId,
          initial: [item1, item2],
          onChange,
        });

        onChange.mockClear();
        selection.deselect('1');

        expect(onChange).toHaveBeenCalledWith([item2]);

        dispose();
      });
    });

    it('should be called on set', () => {
      createRoot((dispose) => {
        const onChange = vi.fn();
        const selection = createSelectionState({ getItemId, onChange });

        selection.set([item1, item2]);

        expect(onChange).toHaveBeenCalledWith([item1, item2]);

        dispose();
      });
    });

    it('should be called on clear', () => {
      createRoot((dispose) => {
        const onChange = vi.fn();
        const selection = createSelectionState({
          getItemId,
          initial: [item1],
          onChange,
        });

        onChange.mockClear();
        selection.clear();

        expect(onChange).toHaveBeenCalledWith([]);

        dispose();
      });
    });
  });
});
