import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposeProvider } from '../context/compose-context';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { ComposeSubject } from './compose-subject';

vi.mock('@ui', async () => ({
  cn: (await import('@ui/utils/classname')).cn,
}));

afterEach(cleanup);

function renderSubject(initialInboxId: 'gmail' | 'outlook', mobile = false) {
  const context = createComposeContext();
  context.accounts.inboxes = () => [
    {
      id: 'gmail',
      email_address: 'me@gmail.test',
      provider: 'GMAIL',
      settings: {},
    },
    {
      id: 'outlook',
      email_address: 'me@outlook.test',
      provider: 'OUTLOOK',
      settings: {},
    },
  ];
  const root = mountEmailComposer(context, undefined, { initialInboxId });
  render(() => (
    <ComposeProvider
      value={{
        ...root.state.context,
        bodyActions: {
          recipientAdded: vi.fn(),
          readDroppedFiles: vi.fn(),
          insertFiles: vi.fn(),
        },
        isMobile: () => mobile,
        scheduleEnabled: true,
      }}
    >
      <ComposeSubject />
    </ComposeProvider>
  ));
  return root;
}

function subjectField() {
  return screen.getByRole('textbox') as HTMLInputElement | HTMLTextAreaElement;
}

function typeSubject(value: string) {
  const field = subjectField();
  field.focus();
  fireEvent.input(field, { target: { value } });
  return field;
}

function describedHint(element: HTMLElement) {
  const id = element.getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent?.trim() : undefined;
}

function overLimitHint(field: HTMLElement) {
  return field.getAttribute('aria-invalid') === 'true'
    ? describedHint(field)
    : undefined;
}

describe('ComposeSubject provider subject limit', () => {
  it('flags an Outlook subject over 255 characters until it is trimmed, without cutting it', () => {
    const root = renderSubject('outlook');
    try {
      const subject = 'a'.repeat(300);
      const field = typeSubject(subject);
      expect(overLimitHint(field)).toBeTruthy();
      expect(field.value).toBe(subject);
      expect(root.state.context.subject()).toBe(subject);

      typeSubject('a'.repeat(255));
      expect(overLimitHint(subjectField())).toBeUndefined();
    } finally {
      root.dispose();
    }
  });

  it('flags a long Outlook subject typed on mobile, also after the field collapses', () => {
    const root = renderSubject('outlook', true);
    try {
      const field = typeSubject('a'.repeat(300));
      expect(overLimitHint(field)).toBeTruthy();

      field.blur();
      expect(describedHint(screen.getByRole('button'))).toBeTruthy();
    } finally {
      root.dispose();
    }
  });

  it('leaves a long Gmail subject alone', () => {
    const root = renderSubject('gmail');
    try {
      expect(overLimitHint(typeSubject('a'.repeat(300)))).toBeUndefined();
    } finally {
      root.dispose();
    }
  });

  it('flags a long subject once the sender switches from Gmail to Outlook', async () => {
    const root = renderSubject('gmail');
    try {
      typeSubject('a'.repeat(300));
      root.state.context.onSelectInbox?.('outlook');
      await waitFor(() =>
        expect(root.state.context.selectedInboxId?.()).toBe('outlook')
      );
      expect(overLimitHint(subjectField())).toBeTruthy();
    } finally {
      root.dispose();
    }
  });
});
