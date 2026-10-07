import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/component/ItemPreview', () => ({ ItemPreview: () => null }));
vi.mock('./TextPart', () => ({ TextPart: () => null }));
vi.mock('../../ui', () => ({
  ToolCard: (props: {
    title: JSX.Element;
    trailing?: JSX.Element;
    children?: JSX.Element;
  }) => (
    <div>
      {props.title}
      <span>{props.trailing}</span>
      {props.children}
    </div>
  ),
  FoldedOutput: (props: { text: string }) => <pre>{props.text}</pre>,
}));

import { UserToolCall } from './UserToolCall';

const input = {
  formId: '0199bfee-1000-7000-8000-000000000002',
  baseRevision: '0199bfee-1000-7000-8000-000000000003',
  draft: {
    audience: 'public',
    status: 'open',
    closesAt: null,
    tallyVisible: false,
    channelGrants: [],
  },
};
const common = {
  id: 'tool-1',
  label: 'SetFormAccess',
  status: 'completed',
  muted: false,
  trailing: undefined,
} as const;
afterEach(cleanup);
describe('resolved Forms session reviews', () => {
  it('keeps partial result diagnostics and reports partial completion', async () => {
    render(() => (
      <UserToolCall
        common={common}
        inFlight={false}
        detail={{
          kind: 'user_tool',
          input,
          outcome: {
            kind: 'completed',
            result: {
              formId: input.formId,
              state: 'partiallyApplied',
              saved: null,
              keys: { columns: {}, questions: {}, sections: {}, options: {} },
              diagnostics: [
                {
                  code: 'Unavailable',
                  path: 'form',
                  message:
                    'Read this form to inspect its saved sharing settings.',
                },
              ],
            },
          },
        }}
      />
    ));
    expect(screen.getByText('Partially saved')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByText(/inspect its saved sharing settings/)
      ).toBeTruthy()
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('states that rejected sharing was unchanged', () => {
    render(() => (
      <UserToolCall
        common={common}
        inFlight={false}
        detail={{ kind: 'user_tool', input, outcome: { kind: 'rejected' } }}
      />
    ));
    expect(screen.getByText(/Sharing was not changed/)).toBeTruthy();
  });
  it('shows a failed outcome without presenting success links', () => {
    render(() => (
      <UserToolCall
        common={common}
        inFlight={false}
        detail={{
          kind: 'user_tool',
          input,
          outcome: {
            kind: 'failed',
            message: 'ReadForm again before sharing.',
          },
        }}
      />
    ));
    expect(screen.getByText('ReadForm again before sharing.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
