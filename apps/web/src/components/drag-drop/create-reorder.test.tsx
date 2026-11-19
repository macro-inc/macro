import { render, screen } from '@solidjs/testing-library';
import {
  createDraggable,
  createDroppable,
  DragDropProvider,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { describe, expect, it, vi } from 'vitest';
import { createReorder } from './create-reorder';

function setup(onDrop = vi.fn()) {
  let reorder!: ReturnType<typeof createReorder>;
  let context!: NonNullable<ReturnType<typeof useDragDropContext>>;
  const Row = () => {
    context = useDragDropContext()!;
    const draggable = createDraggable('source');
    const droppable = createDroppable('target');
    reorder = createReorder({
      order: () => ['source', 'target'],
      getViewport: () => screen.getByTestId('viewport'),
      enabled: () => true,
      previewMarker: 'data-preview',
      locate: () => ({ targetId: 'target', edge: 'before' as const }),
      onDrop,
    });
    return (
      <div data-testid="viewport">
        <div ref={draggable} />
        <div ref={droppable} />
        <span data-testid="preview">
          {reorder.preview() ? 'present' : 'empty'}
        </span>
        <span data-testid="landing">
          {reorder.drop() ? 'present' : 'empty'}
        </span>
      </div>
    );
  };
  const result = render(() => (
    <DragDropProvider>
      <Row />
    </DragDropProvider>
  ));
  const start = () => {
    reorder.start(new MouseEvent('mousedown', { clientX: 10, clientY: 20 }));
    const draggable = context[0].draggables.source;
    reorder.onDragStart({ draggable });
    reorder.collisionDetector(draggable, [context[0].droppables.target], {
      activeDroppableId: null,
    });
    return draggable;
  };
  return { ...result, reorder, start, onDrop };
}

describe('createReorder cancellation', () => {
  it('clears preview and pointer origin and never delivers a cancelled drop', () => {
    const { reorder, start, onDrop, unmount } = setup();
    const draggable = start();
    expect(screen.getByTestId('preview').textContent).toBe('present');
    expect(screen.getByTestId('landing').textContent).toBe('present');
    reorder.cancel();
    expect(screen.getByTestId('preview').textContent).toBe('empty');
    expect(screen.getByTestId('landing').textContent).toBe('empty');
    expect(
      reorder.collisionDetector(draggable, [], { activeDroppableId: null })
    ).toBeNull();
    reorder.onDragEnd({ draggable });
    expect(onDrop).not.toHaveBeenCalled();
    unmount();
  });

  it('cleans up even when the drop handler throws', () => {
    const { reorder, start, unmount } = setup(
      vi.fn(() => {
        throw new Error('drop failed');
      })
    );
    const draggable = start();
    expect(() => reorder.onDragEnd({ draggable })).toThrow('drop failed');
    expect(screen.getByTestId('preview').textContent).toBe('empty');
    expect(screen.getByTestId('landing').textContent).toBe('empty');
    expect(
      reorder.collisionDetector(draggable, [], { activeDroppableId: null })
    ).toBeNull();
    unmount();
  });
});
