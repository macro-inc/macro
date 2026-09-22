/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddCustomMcpDialog } from './add-custom-mcp-dialog';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  startAuth: vi.fn(),
  isPending: false,
}));

vi.mock('@queries/mcp-servers', () => ({
  useAddMcpServerMutation: () => ({
    mutate: mocks.add,
    get isPending() {
      return mocks.isPending;
    },
  }),
  useStartMcpAuthMutation: () => ({
    mutate: mocks.startAuth,
    isPending: false,
  }),
}));

describe('AddCustomMcpDialog', () => {
  beforeEach(() => {
    mocks.add.mockReset();
    mocks.startAuth.mockReset();
    mocks.isPending = false;
  });

  it('saves the server without starting OAuth', () => {
    const onAdded = vi.fn();
    const onOpenChange = vi.fn();
    mocks.add.mockImplementation((_vars, opts) => opts?.onSuccess?.());

    render(() => (
      <AddCustomMcpDialog open onOpenChange={onOpenChange} onAdded={onAdded} />
    ));

    fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: 'Linear' },
    });
    fireEvent.input(screen.getByLabelText('URL'), {
      target: { value: 'https://mcp.linear.app/mcp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(mocks.add).toHaveBeenCalledWith(
      { server_name: 'Linear', url: 'https://mcp.linear.app/mcp' },
      expect.any(Object)
    );
    expect(mocks.startAuth).not.toHaveBeenCalled();
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not submit while the add mutation is pending', () => {
    mocks.isPending = true;
    mocks.add.mockClear();

    render(() => (
      <AddCustomMcpDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />
    ));

    fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: 'Linear' },
    });
    fireEvent.input(screen.getByLabelText('URL'), {
      target: { value: 'https://mcp.linear.app/mcp' },
    });
    fireEvent.keyDown(screen.getByLabelText('URL'), { key: 'Enter' });

    expect(mocks.add).not.toHaveBeenCalled();
  });
});
