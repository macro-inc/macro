/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { SourceControls } from './SourceControls';

function renderControls() {
  const onVisibilityChange = vi.fn<(id: string, visible: boolean) => void>();
  const [visible, setVisible] = createSignal(true);
  const { container } = render(() => (
    <SourceControls
      sources={[{ id: 'cal-1', name: 'gab@macro.com', color: '#ff0000' }]}
      isVisible={() => visible()}
      onVisibilityChange={(id, next) => {
        onVisibilityChange(id, next);
        setVisible(next);
      }}
    />
  ));
  const query = (selector: string) => {
    const element = container.querySelector(selector);
    if (!element) throw new Error(`missing ${selector}`);
    return element;
  };
  return { query, onVisibilityChange, visible };
}

describe('SourceControls', () => {
  it('toggles when the source name is clicked', () => {
    const { query, onVisibilityChange, visible } = renderControls();
    fireEvent.click(query('label'));
    expect(onVisibilityChange).toHaveBeenCalledWith('cal-1', false);
    expect(visible()).toBe(false);
  });

  it('toggles when the checkbox control is clicked', () => {
    const { query, onVisibilityChange, visible } = renderControls();
    fireEvent.click(query('[id$="-control"]'));
    expect(onVisibilityChange).toHaveBeenCalledWith('cal-1', false);
    expect(visible()).toBe(false);
  });
});
