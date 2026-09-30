/**
 * @vitest-environment jsdom
 */

import { createPointerCollisionDetector } from '@components/app/pointer-collision';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import {
  createDroppable,
  DragDropProvider,
  DragDropSensors,
} from '@thisbeyond/solid-dnd';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TreeTag } from './core/tag-tree';
import { createTagDraggable, createTagDropTarget } from './tag-drag-and-drop';

const tag: TreeTag = {
  id: 'urgent',
  label: 'Urgent',
  color: 'red',
  scope: 'user',
  propertyDefinitionId: 'personal-definition',
};

function setup(options: { disabled?: () => boolean } = {}) {
  const onDropTag = vi.fn();
  const onEntityDrop = vi.fn();
  let hovered: Element | null = null;
  const collision = createPointerCollisionDetector(
    () => ({ x: 0, y: 0 }),
    () => hovered
  );

  function Tag() {
    const draggable = createTagDraggable(tag);
    return (
      <div ref={(element) => draggable?.(element)} data-testid="tag">
        Urgent
      </div>
    );
  }

  function Row() {
    const target = createTagDropTarget({
      onDropTag,
      disabled: options.disabled,
    });
    return (
      <div ref={(element) => target?.ref(element)} data-testid="row">
        <span data-testid="row-child">A task</span>
      </div>
    );
  }

  function EntityDropZone() {
    const droppable = createDroppable('entity-zone');
    return <div ref={droppable.ref} data-testid="entity-zone" />;
  }

  const view = render(() => (
    <DragDropProvider
      collisionDetector={collision}
      onDragEnd={({ droppable }) => {
        if (droppable?.id === 'entity-zone') onEntityDrop();
      }}
    >
      <DragDropSensors />
      <Tag />
      <Row />
      <EntityDropZone />
    </DragDropProvider>
  ));

  const dragTagOnto = (testId: string) => {
    hovered = view.getByTestId(testId);
    fireEvent.mouseDown(view.getByTestId('tag'), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 50, clientY: 0 });
    fireEvent.mouseUp(document, { button: 0 });
  };

  return { ...view, onDropTag, onEntityDrop, dragTagOnto };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('tag drag and drop', () => {
  it('hands the dropped tag to the row under the pointer', () => {
    const { dragTagOnto, onDropTag } = setup();
    dragTagOnto('row-child');
    expect(onDropTag).toHaveBeenCalledOnce();
    expect(onDropTag).toHaveBeenCalledWith(tag);
  });

  it('ignores rows that cannot take tags', () => {
    const [disabled] = createSignal(true);
    const { dragTagOnto, onDropTag } = setup({ disabled });
    dragTagOnto('row');
    expect(onDropTag).not.toHaveBeenCalled();
  });

  it('never lands on drop zones meant for entities', () => {
    const { dragTagOnto, onDropTag, onEntityDrop } = setup();
    dragTagOnto('entity-zone');
    expect(onEntityDrop).not.toHaveBeenCalled();
    expect(onDropTag).not.toHaveBeenCalled();
  });

  it('renders plain rows outside a drag provider', () => {
    function Standalone() {
      const draggable = createTagDraggable(tag);
      const target = createTagDropTarget({ onDropTag: () => {} });
      return (
        <div>{String(draggable === undefined && target === undefined)}</div>
      );
    }
    const { container } = render(() => <Standalone />);
    expect(container.textContent).toBe('true');
  });
});
