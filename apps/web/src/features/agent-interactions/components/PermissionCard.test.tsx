/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StopAskingAction } from '../context/interaction';
import { PermissionCard } from './PermissionCard';

afterEach(cleanup);

function card(props: { canAnswer: boolean; stopAsking?: StopAskingAction }) {
  const onSelect = vi.fn();
  const view = render(() => (
    <PermissionCard
      action="Run command"
      detail="cargo test"
      options={[
        { id: 'once', name: 'Allow once', kind: 'allow_once' },
        { id: 'always', name: 'Always allow cargo test', kind: 'allow_always' },
        { id: 'reject', name: 'Reject', kind: 'reject_once' },
      ]}
      canAnswer={props.canAnswer}
      stopAsking={props.stopAsking}
      onSelect={onSelect}
    />
  ));
  return { ...view, onSelect };
}

describe('PermissionCard', () => {
  it('stops the runtime asking apart from the per-tool choices', () => {
    const stopAsking = { running: false, onSelect: vi.fn() };
    const { getByText, onSelect } = card({ canAnswer: true, stopAsking });
    fireEvent.click(getByText('Allow, and stop asking on this runtime'));
    expect(stopAsking.onSelect).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(getByText('Always allow')).toBeTruthy();
  });

  it('offers nothing to stop the asking where it was not offered', () => {
    const { queryByText } = card({ canAnswer: true });
    expect(queryByText('Allow, and stop asking on this runtime')).toBeNull();
  });

  it('offers nothing to a viewer who cannot answer', () => {
    const { queryByText } = card({
      canAnswer: false,
      stopAsking: { running: false, onSelect: vi.fn() },
    });
    expect(queryByText('Allow, and stop asking on this runtime')).toBeNull();
  });
});
