import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Signature } from './Signature';

const state = vi.hoisted(() => ({
  modify: vi.fn(() => true),
  remove: vi.fn(),
  clearDraft: vi.fn(),
  clearActive: vi.fn(),
}));

vi.mock('@core/component/ScopedPortal', () => ({ ScopedPortal: Portal }));
vi.mock('../../context/pdf-document-context', () => ({
  usePdfDocument: () => ({
    portalScope: () => 'global',
    markup: {
      commands: {
        clearDraftIf: state.clearDraft,
        clearActiveIf: state.clearActive,
      },
    },
  }),
}));
vi.mock('../../context/pdf-viewer-context', () => ({
  usePdfViewer: () => ({ rootElement: () => undefined }),
}));
vi.mock('../../store/placeables', () => ({
  useModifyPayload: () => state.modify,
  useDeletePlaceable: () => state.remove,
}));
vi.mock('../../../theme/signals/themeSignals', () => ({
  resolvedThemeColors: () => ({ 'surface-0': { l: 1 } }),
}));

let canvasWidth = 400;
let canvasHeight = 100;
let resize: () => void;
const context = {
  scale: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  moveTo: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  state.modify.mockReturnValue(true);
  canvasWidth = 400;
  canvasHeight = 100;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId = 1;
      pressure = 0.5;
    }
  );
  vi.spyOn(
    HTMLCanvasElement.prototype,
    'offsetWidth',
    'get'
  ).mockImplementation(() => canvasWidth);
  vi.spyOn(
    HTMLCanvasElement.prototype,
    'offsetHeight',
    'get'
  ).mockImplementation(() => canvasHeight);
  vi.spyOn(
    HTMLCanvasElement.prototype,
    'getBoundingClientRect'
  ).mockImplementation(() => new DOMRect(0, 0, canvasWidth, canvasHeight));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,signature'
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const [isNew, setIsNew] = createSignal(true);
  state.clearDraft.mockImplementation(() => setIsNew(false));
  render(() => (
    <Signature
      id="signature-1"
      base64={null}
      isActive={true}
      isNew={isNew()}
      allowableEdits={{
        allowResize: true,
        allowTranslate: true,
        allowRotate: true,
        allowDelete: true,
        lockAspectRatio: true,
      }}
    />
  ));
  const canvas = screen.getByRole('dialog').querySelector('canvas')!;
  return { canvas };
}

function draw(canvas: HTMLCanvasElement) {
  fireEvent.pointerDown(canvas, {
    clientX: 300,
    clientY: 60,
    buttons: 1,
    button: 0,
  });
  fireEvent.pointerMove(window, { clientX: 350, clientY: 70, buttons: 1 });
  fireEvent.pointerUp(window, {
    clientX: 375,
    clientY: 80,
    buttons: 0,
    button: 0,
  });
}

describe('PDF signature editor', () => {
  it('draws using the displayed canvas dimensions and saves before closing', () => {
    const { canvas } = setup();
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(200);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Use signature' })
        .disabled
    ).toBe(true);
    draw(canvas);
    expect(context.arc).toHaveBeenCalled();
    expect(context.scale).toHaveBeenCalledWith(2, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Use signature' }));
    expect(state.modify).toHaveBeenCalledWith('signature-1', 'signature', {
      base64: 'data:image/png;base64,signature',
    });
    expect(state.modify.mock.invocationCallOrder[0]).toBeLessThan(
      state.clearDraft.mock.invocationCallOrder[0]
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state.remove).not.toHaveBeenCalled();
  });

  it('retains the drawing when the dialog gets narrower', () => {
    const { canvas } = setup();
    draw(canvas);
    context.arc.mockClear();
    canvasWidth = 320;
    canvasHeight = 80;
    resize();
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(160);
    expect(context.arc).toHaveBeenCalledWith(
      240,
      48,
      expect.any(Number),
      0,
      2 * Math.PI,
      false
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use signature' }));
    expect(state.modify).toHaveBeenCalled();
  });

  it('discards a drawn draft when cancelled and clears its editor state', () => {
    const { canvas } = setup();
    draw(canvas);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel signature' }));
    expect(state.remove).toHaveBeenCalledExactlyOnceWith('signature-1');
    expect(state.clearDraft).toHaveBeenCalledWith('signature-1');
    expect(state.modify).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('discards an empty draft on Escape', () => {
    setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(state.remove).toHaveBeenCalledExactlyOnceWith('signature-1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the drawing open if the placeable cannot be updated', () => {
    const { canvas } = setup();
    draw(canvas);
    state.modify.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Use signature' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(state.clearDraft).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
});
