/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionLine } from './ActionLine';

afterEach(cleanup);

describe('ActionLine', () => {
  it('reveals context as literal text with neutral styling', () => {
    const detail = '<script>untrusted content</script>';
    const view = render(() => (
      <ActionLine label="Agent context" detail={detail} />
    ));
    fireEvent.click(view.getByRole('button', { name: /Agent context/ }));
    expect(view.getByText(detail).classList.contains('bg-hover')).toBe(true);
    expect(view.container.querySelector('script')).toBeNull();
  });

  it('expands to show the full detail when its label is clicked', () => {
    const detail =
      'herdr agent start failed: {"error":{"code":"agent_pane_busy"}}';
    const view = render(() => (
      <ActionLine label="Something went wrong" detail={detail} failed />
    ));
    const toggle = view.getByRole('button', { name: /Something went wrong/ });
    expect(view.queryByText(detail)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(view.getByText(detail)).toBeTruthy();

    fireEvent.click(toggle);
    expect(view.queryByText(detail)).toBeNull();
  });

  it('is not a button when there is no detail', () => {
    const view = render(() => <ActionLine label="Context compacted" />);
    expect(view.queryByRole('button')).toBeNull();
  });
});
