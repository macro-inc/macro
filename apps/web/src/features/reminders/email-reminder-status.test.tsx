import type { EntityData } from '@entity';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailReminderStatus } from './email-reminder-status';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  makeAction: vi.fn(),
  activeCommand: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@queries/reminders/email-followup', () => ({
  useEmailFollowupQuery: () => ({ isSuccess: true, data: null }),
}));
vi.mock('../next-soup/actions/make-create-reminder-action', () => ({
  makeCreateReminderAction: mocks.makeAction,
}));
vi.mock('@core/hotkey/utils', () => ({
  getActiveCommandByToken: mocks.activeCommand,
  runCommand: vi.fn(),
}));
vi.mock('@ui', () => ({
  Button: (props: { label: string; onClick: () => void }) => (
    <button onClick={props.onClick}>{props.label}</button>
  ),
}));
afterEach(cleanup);
it('always targets its visible thread even when another surface owns the active hotkey', () => {
  mocks.makeAction.mockReturnValue({ execute: mocks.execute });
  mocks.activeCommand.mockReturnValue({ id: 'another-thread-command' });
  const entity = {
    id: 'visible-thread',
    type: 'email',
    name: 'Subject',
  } as EntityData;
  const onSaved = vi.fn();
  render(() => <EmailReminderStatus entity={entity} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remind me' }));
  expect(mocks.execute).toHaveBeenCalledWith([entity]);
  expect(mocks.makeAction).toHaveBeenCalledWith({ onEmailSaved: onSaved });
  expect(mocks.activeCommand).not.toHaveBeenCalled();
});
