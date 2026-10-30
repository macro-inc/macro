import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type ComponentProps, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailInbox } from '../context/compose-capabilities';
import type { EmailFormRecipients } from '../core/email-recipient';
import { createReplyRecipientFields } from '../primitives/reply-recipient-fields';
import { ReplyEnvelope } from './reply-envelope';

vi.mock('@ui', async () => ({
  cn: (await import('@ui/utils/classname')).cn,
  Button: (props: ComponentProps<'button'>) => <button {...props} />,
}));
vi.mock('@core/component/RecipientSelector', () => ({
  RecipientSelector: () => null,
}));
vi.mock('../components/from-inbox-selector', () => ({
  FromInboxSelector: () => null,
}));

const inboxes: EmailInbox[] = [
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

const disposers: (() => void)[] = [];
afterEach(() => {
  cleanup();
  disposers.splice(0).forEach((dispose) => dispose());
});

function renderEnvelope(inboxId: 'gmail' | 'outlook', mobile: boolean) {
  const state = createRoot((dispose) => {
    disposers.push(dispose);
    const [values, setValues] = createSignal<EmailFormRecipients>({
      to: [],
      cc: [],
      bcc: [],
    });
    const [subject, setSubject] = createSignal('');
    const [activeInboxId, setActiveInboxId] = createSignal(inboxId);
    return {
      values,
      subject,
      setSubject,
      activeInboxId,
      setActiveInboxId,
      fields: createReplyRecipientFields({
        values,
        container: () => undefined,
        disabled: () => false,
        onChange: () => {},
        setValues: (field, recipients) =>
          setValues((prev) => ({ ...prev, [field]: recipients })),
      }),
    };
  });
  render(() => (
    <ReplyEnvelope
      fields={state.fields}
      values={state.values}
      options={() => []}
      inboxes={() => inboxes}
      activeInboxId={state.activeInboxId}
      senderEmail={() => undefined}
      onSenderChange={() => {}}
      subject={state.subject}
      onSubjectChange={state.setSubject}
      showSubject
      mobile={() => mobile}
      portalScope={() => undefined}
      replyType={() => 'forward'}
      disabled={() => false}
    />
  ));
  const input = screen.getByPlaceholderText(
    mobile ? 'Subject:' : 'Subject'
  ) as HTMLInputElement;
  return {
    ...state,
    input,
    type(value: string) {
      input.focus();
      fireEvent.input(input, { target: { value } });
    },
  };
}

function overLimitHint(input: HTMLInputElement) {
  if (input.getAttribute('aria-invalid') !== 'true') return undefined;
  const id = input.getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent?.trim() : undefined;
}

describe.each([false, true])(
  'ReplyEnvelope subject limit (mobile=%s)',
  (mobile) => {
    it('flags an Outlook subject over 255 characters until it is trimmed, without cutting it', () => {
      const envelope = renderEnvelope('outlook', mobile);
      const subject = 'a'.repeat(300);
      envelope.type(subject);
      expect(overLimitHint(envelope.input)).toBeTruthy();
      expect(envelope.input.value).toBe(subject);
      expect(envelope.subject()).toBe(subject);

      envelope.type('a'.repeat(255));
      expect(overLimitHint(envelope.input)).toBeUndefined();
    });

    it('flags a long Gmail subject only after switching to Outlook', () => {
      const envelope = renderEnvelope('gmail', mobile);
      envelope.type('a'.repeat(300));
      expect(overLimitHint(envelope.input)).toBeUndefined();

      envelope.setActiveInboxId('outlook');
      expect(overLimitHint(envelope.input)).toBeTruthy();
    });
  }
);
