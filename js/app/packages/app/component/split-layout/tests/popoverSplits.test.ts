import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSplitLayout, type SplitManager } from '../layoutManager';

// Mock dependencies
vi.mock('@core/orchestrator', () => ({
  createBlockOrchestrator: () => ({
    getBlockHandle: vi.fn(),
    createBlockInstance: vi.fn(),
  }),
}));

vi.mock('../componentRegistry', () => ({
  resolveComponent: vi.fn((id: string, params: Record<string, string>) => ({
    element: () => `Mock component: ${id}`,
    initialMeta: { kind: id },
  })),
}));

describe('Popover Splits', () => {
  let splitManager: SplitManager;
  let mockOrchestrator: any;

  beforeEach(() => {
    mockOrchestrator = {
      getBlockHandle: vi.fn(),
      createBlockInstance: vi.fn(),
    };

    createRoot(() => {
      splitManager = createSplitLayout(mockOrchestrator, []);
    });
  });

  describe('createPopoverSplit', () => {
    it('should create a new popover split', () => {
      const handle = splitManager.createPopoverSplit({
        content: {
          type: 'component',
          id: 'test-component',
        },
      });

      expect(handle).toBeDefined();
      expect(handle.id).toMatch(/^popover-/);
      expect(handle.isOpen()).toBe(true);
      expect(handle.content()).toEqual({
        type: 'component',
        id: 'test-component',
      });
    });

    it('should call onClose when popover is closed', () => {
      const onClose = vi.fn();
      const handle = splitManager.createPopoverSplit({
        content: {
          type: 'component',
          id: 'test-component',
        },
        onClose,
      });

      handle.close();
      expect(onClose).toHaveBeenCalled();
      expect(handle.isOpen()).toBe(false);
    });

    it('should create popover with custom style options', () => {
      const handle = splitManager.createPopoverSplit({
        content: {
          type: 'component',
          id: 'test-component',
        },
        style: {
          maxWidth: '800px',
          maxHeight: '600px',
          position: 'center',
          className: 'custom-class',
        },
      });

      expect(handle).toBeDefined();
      expect(handle.isOpen()).toBe(true);
    });
  });

  describe('getActivePopovers', () => {
    it('should return empty array when no popovers are active', () => {
      const activePopovers = splitManager.getActivePopovers();
      expect(activePopovers).toEqual([]);
    });

    it('should return active popovers', () => {
      const handle1 = splitManager.createPopoverSplit({
        content: { type: 'component', id: 'test1' },
      });

      const handle2 = splitManager.createPopoverSplit({
        content: { type: 'component', id: 'test2' },
      });

      const activePopovers = splitManager.getActivePopovers();
      expect(activePopovers).toHaveLength(2);
      expect(activePopovers.map((p) => p.id)).toContain(handle1.id);
      expect(activePopovers.map((p) => p.id)).toContain(handle2.id);
    });

    it('should not include closed popovers in active list', () => {
      const handle1 = splitManager.createPopoverSplit({
        content: { type: 'component', id: 'test1' },
      });

      const handle2 = splitManager.createPopoverSplit({
        content: { type: 'component', id: 'test2' },
      });

      handle1.close();

      const activePopovers = splitManager.getActivePopovers();
      expect(activePopovers).toHaveLength(1);
      expect(activePopovers[0].id).toBe(handle2.id);
    });
  });

  describe('closeAllPopovers', () => {
    it('should close all active popovers', () => {
      const onClose1 = vi.fn();
      const onClose2 = vi.fn();

      const handle1 = splitManager.createPopoverSplit({
        content: { type: 'component', id: 'test1' },
        onClose: onClose1,
      });

      const handle2 = splitManager.createPopoverSplit({
        content: { type: 'component', id: 'test2' },
        onClose: onClose2,
      });

      splitManager.closeAllPopovers();

      expect(handle1.isOpen()).toBe(false);
      expect(handle2.isOpen()).toBe(false);
      expect(onClose1).toHaveBeenCalled();
      expect(onClose2).toHaveBeenCalled();
    });

    it('should result in empty active popovers list', () => {
      splitManager.createPopoverSplit({
        content: { type: 'component', id: 'test1' },
      });

      splitManager.createPopoverSplit({
        content: { type: 'component', id: 'test2' },
      });

      splitManager.closeAllPopovers();

      const activePopovers = splitManager.getActivePopovers();
      expect(activePopovers).toEqual([]);
    });
  });

  describe('popovers reactive accessor', () => {
    it('should provide reactive access to popovers map', () => {
      createRoot(() => {
        const [popoversCount, setPopoversCount] = createSignal(0);

        // Track changes to popovers
        const popovers = splitManager.popovers;

        // Create a popover
        const handle = splitManager.createPopoverSplit({
          content: { type: 'component', id: 'test' },
        });

        expect(popovers().size).toBe(1);
        expect(popovers().has(handle.id)).toBe(true);

        // Close the popover
        handle.close();
        expect(popovers().get(handle.id)?.isOpen).toBe(false);
      });
    });
  });

  describe('popover lifecycle', () => {
    it('should create mount for component content', () => {
      const handle = splitManager.createPopoverSplit({
        content: {
          type: 'component',
          id: 'test-component',
          params: { key: 'value' },
        },
      });

      const popover = splitManager.popovers().get(handle.id);
      expect(popover).toBeDefined();
      expect(popover?.mount).toBeDefined();
      expect(popover?.mount.kind).toBe('component');
    });

    it('should handle block content', () => {
      const handle = splitManager.createPopoverSplit({
        content: {
          type: 'chat' as any,
          id: 'test-block-id',
          params: { key: 'value' },
        },
      });

      const popover = splitManager.popovers().get(handle.id);
      expect(popover).toBeDefined();
      expect(popover?.content.type).toBe('chat');
      expect(popover?.content.id).toBe('test-block-id');
    });
  });

  describe('error handling', () => {
    it('should handle invalid component IDs gracefully', () => {
      expect(() => {
        splitManager.createPopoverSplit({
          content: {
            type: 'component',
            id: 'non-existent-component',
          },
        });
      }).not.toThrow();
    });

    it('should handle closing non-existent popover', () => {
      const handle = splitManager.createPopoverSplit({
        content: { type: 'component', id: 'test' },
      });

      // Close twice
      handle.close();
      expect(() => handle.close()).not.toThrow();
      expect(handle.isOpen()).toBe(false);
    });
  });
});
