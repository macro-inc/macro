/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ComponentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailComposeToolbar } from './compose-toolbar';

const send = vi.hoisted(() => vi.fn());
vi.mock('@core/directive/fileSelector', () => ({ fileSelector: vi.fn() }));
vi.mock('@core/component/LexicalMarkdown/plugins', () => ({
  defaultSelectionData: {},
}));
vi.mock(
  '@core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin',
  () => ({
    NODE_TRANSFORM: Symbol('node-transform'),
  })
);
vi.mock('../components/email-date-selector', () => ({
  EmailDateSelector: () => null,
}));
vi.mock('../components/email-schedule-summary', () => ({
  EmailScheduleSummary: () => null,
}));
vi.mock('../context/compose-context', () => ({
  useCompose: () => ({
    isMobile: () => true,
    hasDraft: () => false,
    hideAttachments: true,
    scheduleEnabled: false,
    disabled: () => false,
    primaryActionDisabled: () => false,
    isSending: () => false,
    schedule: {
      actionLabel: () => 'Send email',
      state: () => ({ type: 'editing', intent: { type: 'immediate' } }),
    },
    onSend: send,
  }),
}));
vi.mock('@channel/Input/FormatButtons', () => ({ FormatButtons: () => null }));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: ComponentProps<'div'>) => (
    <div>{props.children}</div>
  ),
  SplitHeaderRight: (props: ComponentProps<'div'>) => (
    <div data-testid="page-header-actions">{props.children}</div>
  ),
}));
vi.mock('@components/app/split-layout/components/HeaderIsland', () => ({
  HeaderIsland: (props: ComponentProps<'div'>) => <div>{props.children}</div>,
}));
vi.mock('@ui', () => ({
  Button: (props: ComponentProps<'button'>) => <button {...props} />,
  SendButton: (props: ComponentProps<'button'>) => <button {...props} />,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('embedded email toolbar on mobile', () => {
  it('keeps each draft send action in its own card instead of the page header', () => {
    render(() => <EmailComposeToolbar inline />);
    expect(screen.queryByTestId('page-header-actions')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
    expect(send).toHaveBeenCalledExactlyOnceWith();
  });
  it('keeps the full-page mobile composer actions in the page header', () => {
    render(() => <EmailComposeToolbar />);
    expect(
      screen
        .getByTestId('page-header-actions')
        .contains(screen.getByRole('button', { name: 'Send email' }))
    ).toBe(true);
  });
});
