/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ToolApprovalCard,
  type ToolApprovalCardProps,
} from './ToolApprovalCard';

afterEach(cleanup);

function card(overrides: Partial<ToolApprovalCardProps>) {
  const handlers = {
    onApprove: vi.fn(),
    onApproveAlways: vi.fn(),
    onDeny: vi.fn(),
    onCancel: vi.fn(),
  };
  const view = render(() => (
    <ToolApprovalCard
      action="read your email"
      requester="julia@macro.com"
      owner="wolf@macro.com"
      canApprove={false}
      canCancel={false}
      {...handlers}
      {...overrides}
    />
  ));
  return { ...view, ...handlers };
}

describe('ToolApprovalCard', () => {
  it('asks the owner to approve or decline, saying what the agent wants and who asked', () => {
    const { getByText, onApprove, onDeny } = card({ canApprove: true });
    expect(getByText('Approval needed')).toBeTruthy();
    expect(
      getByText('julia@macro.com asked the agent to read your email.')
    ).toBeTruthy();
    fireEvent.click(getByText('Approve'));
    fireEvent.click(getByText('Decline'));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onDeny).toHaveBeenCalledOnce();
  });

  it('lets the owner approve for good, saying what that covers', () => {
    const { getByText, onApproveAlways } = card({
      canApprove: true,
      standing: 'use your Linear account',
    });
    expect(
      getByText(
        'Always allow lets julia@macro.com use your Linear account in this session without asking you.'
      )
    ).toBeTruthy();
    fireEvent.click(getByText('Always allow'));
    expect(onApproveAlways).toHaveBeenCalledOnce();
  });

  it('offers no standing approval when there is nobody to remember', () => {
    const { queryByText } = card({ canApprove: true });
    expect(queryByText('Always allow')).toBeNull();
  });

  it('shows everyone else who it waits for, with a way out for editors', () => {
    const { getByText, queryByText, onCancel } = card({ canCancel: true });
    expect(getByText('Waiting for wolf@macro.com to approve')).toBeTruthy();
    expect(queryByText('Approve')).toBeNull();
    expect(queryByText('Always allow')).toBeNull();
    fireEvent.click(getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('leaves a viewer nothing to press', () => {
    const { queryByText } = card({});
    expect(queryByText('Cancel')).toBeNull();
    expect(queryByText('Approve')).toBeNull();
  });
});
