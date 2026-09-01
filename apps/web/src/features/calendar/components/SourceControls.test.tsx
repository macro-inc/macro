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
  return { container, onVisibilityChange, visible };
}

describe('SourceControls', () => {
  it('toggles when the row is clicked', () => {
    const { container, onVisibilityChange, visible } = renderControls();
    const label = container.querySelector('label');
    if (!label) throw new Error('missing label');
    fireEvent.click(label);
    expect(onVisibilityChange).toHaveBeenCalledWith('cal-1', false);
    expect(visible()).toBe(false);
  });

  it('toggles when the checkbox control itself is clicked', () => {
    const { container, onVisibilityChange, visible } = renderControls();
    const control = container.querySelector('[id$="-control"]');
    if (!control) throw new Error('missing checkbox control');
    fireEvent.click(control);
    expect(onVisibilityChange).toHaveBeenCalledWith('cal-1', false);
    expect(visible()).toBe(false);
  });
});
