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
    onDeny: vi.fn(),
    onCancel: vi.fn(),
  };
  const view = render(() => (
    <ToolApprovalCard
      server="Macro"
      tool="ListEmails"
      detail={'{\n  "limit": 5\n}'}
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
  it('asks the owner to approve or decline, naming the tool and who asked', () => {
    const { getByText, onApprove, onDeny } = card({ canApprove: true });
    expect(getByText('Approval needed')).toBeTruthy();
    expect(
      getByText(
        'julia@macro.com asked the agent to use a tool with your access.'
      )
    ).toBeTruthy();
    expect(getByText('Macro · ListEmails')).toBeTruthy();
    fireEvent.click(getByText('Approve'));
    fireEvent.click(getByText('Decline'));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onDeny).toHaveBeenCalledOnce();
  });

  it('shows everyone else who it waits for, with a way out for editors', () => {
    const { getByText, queryByText, onCancel } = card({ canCancel: true });
    expect(getByText('Waiting for wolf@macro.com to approve')).toBeTruthy();
    expect(queryByText('Approve')).toBeNull();
    fireEvent.click(getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('leaves a viewer nothing to press', () => {
    const { queryByText } = card({});
    expect(queryByText('Cancel')).toBeNull();
    expect(queryByText('Approve')).toBeNull();
  });
});
