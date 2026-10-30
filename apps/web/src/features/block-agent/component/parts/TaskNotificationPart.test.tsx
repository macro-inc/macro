/**
 * @vitest-environment jsdom
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { render } from '@solidjs/testing-library';
import { expect, it, vi } from 'vitest';
import { TaskNotificationPart } from './TaskNotificationPart';

// The `ui` barrel reaches the chat input's storage module on import (the
// `ControlPart.test.tsx` idiom).
vi.mock('../../ui', () => ({
  ActionLine: (props: { label: string; failed?: boolean }) => (
    <div data-testid="action-line" data-failed={String(props.failed ?? false)}>
      {props.label}
    </div>
  ),
}));

type TaskNotification = Extract<MessagePart, { kind: 'task_notification' }>;

it.each<[TaskNotification, string, string]>([
  [
    {
      kind: 'task_notification',
      status: 'completed',
      summary: 'Background command "Run tests" completed (exit code 0)',
      event: null,
    },
    'Background command "Run tests" completed (exit code 0)',
    'false',
  ],
  [
    {
      kind: 'task_notification',
      status: 'failed',
      summary: 'Background command "Run tests" failed with exit code 1',
      event: null,
    },
    'Background command "Run tests" failed with exit code 1',
    'true',
  ],
  [
    {
      kind: 'task_notification',
      status: 'completed',
      summary: 'Agent "Research" finished',
      event: null,
    },
    'Agent "Research" finished',
    'false',
  ],
  [
    {
      kind: 'task_notification',
      status: null,
      summary: 'Monitor event: "PR checks"',
      event: 'check: fail',
    },
    'Monitor event: "PR checks" · check: fail',
    'false',
  ],
  [
    { kind: 'task_notification', status: null, summary: '', event: null },
    'Background task update',
    'false',
  ],
])('reads %o as one system line', (part, label, failed) => {
  const { getByTestId } = render(() => <TaskNotificationPart part={part} />);
  expect(getByTestId('action-line').textContent).toBe(label);
  expect(getByTestId('action-line').getAttribute('data-failed')).toBe(failed);
});
