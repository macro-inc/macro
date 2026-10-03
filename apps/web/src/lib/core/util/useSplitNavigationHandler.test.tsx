import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useNativeSplitNavigationHandler,
  useSplitNavigationHandler,
} from './useSplitNavigationHandler';

afterEach(cleanup);

/**
 * Stands in for the editable editor shell (`MarkdownShell`), which stops
 * click and mousedown propagation at the editor's wrapper element.
 */
function EditorShell(props: { children: any }) {
  return (
    <div
      on:click={(event) => event.stopPropagation()}
      on:mousedown={(event) => event.stopPropagation()}
    >
      {props.children}
    </div>
  );
}

describe('useSplitNavigationHandler', () => {
  it('opens on click and blocks the mousedown default outside an editor', () => {
    const onClick = vi.fn();
    const view = render(() => (
      <span {...useSplitNavigationHandler<HTMLSpanElement>(onClick)}>
        Mention
      </span>
    ));
    const chip = view.getByText('Mention');
    expect(fireEvent.mouseDown(chip)).toBe(false);
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('never fires inside an editor shell, because delegation is cut off', () => {
    const onClick = vi.fn();
    const view = render(() => (
      <EditorShell>
        <span {...useSplitNavigationHandler<HTMLSpanElement>(onClick)}>
          Mention
        </span>
      </EditorShell>
    ));
    fireEvent.click(view.getByText('Mention'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('useNativeSplitNavigationHandler', () => {
  it('opens on click inside an editor shell', () => {
    const onClick = vi.fn();
    const view = render(() => (
      <EditorShell>
        <span {...useNativeSplitNavigationHandler<HTMLSpanElement>(onClick)}>
          Mention
        </span>
      </EditorShell>
    ));
    const chip = view.getByText('Mention');
    expect(fireEvent.mouseDown(chip)).toBe(false);
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('lets the handler stop the click from reaching ancestors', () => {
    const outer = vi.fn();
    const view = render(() => (
      <div on:click={outer}>
        <span
          {...useNativeSplitNavigationHandler<HTMLSpanElement>((event) =>
            event.stopPropagation()
          )}
        >
          Mention
        </span>
      </div>
    ));
    fireEvent.click(view.getByText('Mention'));
    expect(outer).not.toHaveBeenCalled();
  });
});
