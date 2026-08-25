/**
 * @vitest-environment jsdom
 */

import { toast } from '@core/component/Toast/Toast';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displaySubject } from '../util/subjectText';
import { CopySubjectButton } from './CopySubjectButton';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

const writeText = vi.fn();

afterEach(cleanup);

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  writeText.mockReset();
  vi.mocked(toast.success).mockReset();
});

describe('CopySubjectButton', () => {
  it('copies a real subject and toasts Subject copied', () => {
    render(() => <CopySubjectButton subject="Q3 contract" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy subject' }));

    expect(writeText).toHaveBeenCalledWith('Q3 contract');
    expect(toast.success).toHaveBeenCalledWith('Subject copied');
  });

  it('renders nothing for a placeholder subject', () => {
    const { container } = render(() => (
      <CopySubjectButton subject={displaySubject('')} />
    ));

    expect(screen.queryByRole('button', { name: 'Copy subject' })).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders nothing for an empty subject', () => {
    const { container } = render(() => <CopySubjectButton subject="" />);

    expect(screen.queryByRole('button', { name: 'Copy subject' })).toBeNull();
    expect(container.textContent).toBe('');
  });
});
