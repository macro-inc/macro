import { createGraphicsEditor, translation } from '@macro-inc/graphics';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasReadOnlyView } from './canvas-read-only-view';

vi.mock('@core/component/DocumentPreview', () => ({
  DocumentPreviewContent: () => null,
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => 'md',
}));
vi.mock('./embedded-items', () => ({ CanvasMediaView: () => null }));
vi.mock('./text-content', () => ({ CanvasTextContent: () => null }));

afterEach(cleanup);

it('offers only navigation tools, hides transform handles and keeps shortcuts inside the canvas', () => {
  const editor = createGraphicsEditor([
    {
      id: 'shape',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(0, 0),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'white', stroke: 'black' },
    },
  ]);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const outerKeyDown = vi.fn();
  const view = render(() => (
    <div on:keydown={outerKeyDown}>
      <CanvasReadOnlyView editor={editor} fitOnLoad={false} />
    </div>
  ));
  try {
    const canvas = screen.getByRole('region', { name: 'Graphics canvas' });
    expect(screen.queryByLabelText('Rectangle tool')).toBeNull();
    expect(screen.queryByLabelText('Canvas inspector')).toBeNull();
    expect(screen.queryByText('Fit canvas')).toBeNull();
    expect(screen.getByLabelText('Zoom level').textContent).toBe('100%');
    fireEvent.click(screen.getByLabelText('Zoom in', { exact: true }));
    expect(editor.getCamera().scale).toBeCloseTo(1.2);
    expect(screen.getByLabelText('Zoom level').textContent).toBe('120%');
    fireEvent.click(screen.getByLabelText('Zoom out', { exact: true }));
    expect(editor.getCamera().scale).toBeCloseTo(1);
    editor.zoomAt({ x: 0, y: 0 }, 0.5);
    expect(screen.getByLabelText('Zoom level').textContent).toBe('50%');
    fireEvent.click(screen.getByLabelText('Hand tool'));
    expect(canvas.style.cursor).toBe('grab');
    expect(document.activeElement).toBe(canvas);
    fireEvent.keyDown(canvas, { key: 'v' });
    expect(canvas.style.cursor).not.toBe('grab');
    fireEvent.keyDown(canvas, { key: 'h' });
    expect(canvas.style.cursor).toBe('grab');
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(outerKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(canvas, { key: 'v' });
    editor.select('shape');
    expect(
      view.container.querySelector('[data-graphics-selection-bounds]')
    ).toBeTruthy();
    expect(view.container.querySelector('[data-graphics-handle]')).toBeNull();
  } finally {
    view.unmount();
    editor.dispose();
    vi.unstubAllGlobals();
  }
});
