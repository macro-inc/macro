import { afterEach, expect, it, vi } from 'vitest';
import { attachConnectorControls } from '../src/browser';
import {
  createConnectorInteraction,
  createGraphicsEditor,
  resolveConnector,
  setConnectorCommand,
} from '../src/core';

// The test DOM has no PointerEvent; the connector controls read these fields.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? '';
  }
}
vi.stubGlobal('PointerEvent', TestPointerEvent);

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

/** A free connector from (50, 50) to (150, 50), selected, with its end to press. */
function setup() {
  const editor = createGraphicsEditor([]);
  const interaction = createConnectorInteraction({
    getDocument: () => editor.document,
    commit: (item) => editor.execute(setConnectorCommand, item),
    onChange: () => {},
  });
  interaction.begin(
    'link',
    { x: 50, y: 50 },
    { fill: 'transparent', stroke: 'black' },
    { route: 'straight', startHead: 'none', endHead: 'arrow' },
    14
  );
  interaction.update({ x: 150, y: 50 }, 14);
  interaction.commit();
  editor.select('link');

  const viewport = document.createElement('div');
  viewport.tabIndex = 0;
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  // The end as the renderer draws it: the handle a press can land on, and the
  // wider target the touch view lays around it.
  const endHandle = document.createElement('div');
  endHandle.dataset.graphicsConnectorEnd = 'end';
  endHandle.dataset.graphicsConnectorId = 'link';
  const endReach = endHandle.cloneNode() as HTMLElement;
  endReach.dataset.graphicsConnectorReach = '';
  viewport.append(endReach, endHandle);
  document.body.append(viewport);
  const detach = attachConnectorControls(viewport, editor, {
    interaction,
    active: () => false,
    appearance: () => ({ fill: 'transparent', stroke: 'black' }),
    style: () => ({ route: 'straight', startHead: 'none', endHead: 'arrow' }),
    onCommit: () => {},
  });
  cleanups.push(() => {
    detach();
    editor.dispose();
    viewport.remove();
  });

  const pointer = (
    pointerType: 'touch' | 'pen' | 'mouse',
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    x: number,
    y: number,
    pressed: Element = endHandle
  ) =>
    (type === 'pointerdown' ? pressed : window).dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
      })
    );
  /** Where the connector ends, in the document or in the gesture's preview. */
  const end = (document = editor.document) => {
    const item = document.items.link;
    if (item?.type !== 'connector') throw new Error('The connector is gone');
    return resolveConnector(document, item).geometry.end.point;
  };
  return { editor, interaction, pointer, end, endReach };
}

it.each(['touch', 'pen'] as const)(
  'leaves an end where it is when a %s only taps near it',
  (pointerType) => {
    const { editor, interaction, pointer, end } = setup();
    const undoable = editor.getSession().canUndo;
    const before = editor.document;

    // 10px from the end, inside a finger's reach of it, with a tap's wobble.
    pointer(pointerType, 'pointerdown', 158, 56);
    pointer(pointerType, 'pointermove', 159, 57);
    expect(end(interaction.getPreviewDocument())).toEqual({ x: 150, y: 50 });
    pointer(pointerType, 'pointerup', 159, 57);

    expect(end()).toEqual({ x: 150, y: 50 });
    expect(editor.document).toBe(before);
    expect(editor.getSession().canUndo).toBe(undoable);
    expect(interaction.getState()).toBeUndefined();
  }
);

it('moves an end by as much as the finger that took it has moved', () => {
  const { pointer, end } = setup();

  // Taken from 10px away, the end keeps that distance from the finger.
  pointer('touch', 'pointerdown', 158, 56);
  pointer('touch', 'pointermove', 200, 90);
  pointer('touch', 'pointerup', 200, 90);
  expect(end()).toEqual({ x: 192, y: 84 });

  // So a tap that wobbles moves it by the wobble, not to the finger.
  pointer('touch', 'pointerdown', 200, 92);
  pointer('touch', 'pointermove', 205, 95);
  pointer('touch', 'pointerup', 205, 95);
  expect(end()).toEqual({ x: 197, y: 87 });
});

it('treats any pointer that takes an end by its wider target as a finger', () => {
  const { editor, pointer, end, endReach } = setup();
  const before = editor.document;

  // A trackpad on a tablet: a click 10px from the end, on the target around it.
  pointer('mouse', 'pointerdown', 158, 56, endReach);
  pointer('mouse', 'pointerup', 158, 56);
  expect(editor.document).toBe(before);

  pointer('mouse', 'pointerdown', 158, 56, endReach);
  pointer('mouse', 'pointermove', 178, 66);
  pointer('mouse', 'pointerup', 178, 66);
  expect(end()).toEqual({ x: 170, y: 60 });
});

it('keeps the end a pen is moving when the system takes a palm away', () => {
  const { interaction, pointer, end } = setup();

  pointer('pen', 'pointerdown', 152, 51);
  pointer('pen', 'pointermove', 200, 90);
  window.dispatchEvent(
    new PointerEvent('pointercancel', {
      bubbles: true,
      pointerId: 2,
      pointerType: 'touch',
    })
  );
  expect(interaction.getState()).toBeDefined();
  pointer('pen', 'pointerup', 200, 90);

  expect(end().x).toBeGreaterThan(190);
});

it('leaves a mouse press on an end as it was', () => {
  const { pointer, end } = setup();

  // A cursor lands on the end itself, and its release has always placed it.
  pointer('mouse', 'pointerdown', 152, 51);
  pointer('mouse', 'pointerup', 152, 51);

  expect(end()).toEqual({ x: 152, y: 51 });
});
