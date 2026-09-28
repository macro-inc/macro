import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityEmailParticipants } from '../extractors/entity-email-participants';
import type { EmailEntity } from '../types/entity';

// The viewer's address book knows notifications@cal.com as "Nathan Flurry"
// (the first person who booked through it) and wolf@macro.com as a Macro user.
const addressBook: Record<string, string> = {
  'macro|notifications@cal.com': 'Nathan Flurry',
  'macro|wolf@macro.com': 'Wolf Ryan',
};

vi.mock('@core/user', () => ({
  emailToMacroId: (email: string) => `macro|${email.toLowerCase()}`,
  getDisplayName: (id: string) => addressBook[id] ?? id.replace('macro|', ''),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'teo@macro.com',
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: unknown }) => <>{props.trigger}</>,
}));
vi.mock('@core/component/UserTooltip', () => ({
  UserTooltip: () => null,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: () => {} },
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => <>{props.markdown}</>,
  })
);
vi.mock('@core/component/LexicalMarkdown/theme', () => ({
  unifiedListMarkdownTheme: {},
}));

afterEach(cleanup);

const emailEntity = (
  participants: NonNullable<EmailEntity['participants']>
): EmailEntity =>
  ({
    id: 'thread-1',
    type: 'email',
    name: 'Subject',
    participants,
  }) as unknown as EmailEntity;

describe('EntityEmailParticipants', () => {
  it('shows the From display name of the message, not the address-book name of a shared sender', () => {
    const { container } = render(() => (
      <EntityEmailParticipants
        entity={emailEntity([
          { email: 'notifications@cal.com', name: 'Cal.com' },
        ])}
      />
    ));

    expect(container.textContent).toBe('Cal.com');
  });

  it('keeps distinct From names apart for messages from the same shared address', () => {
    const { container } = render(() => (
      <EntityEmailParticipants
        entity={emailEntity([
          { email: 'notifications@cal.com', name: 'Cal.com' },
          { email: 'notifications@cal.com', name: 'Nathan Flurry' },
        ])}
      />
    ));

    expect(container.textContent).toBe('Cal.com, Nathan');
  });

  it('falls back to the Macro display name when the message carries no From name', () => {
    const { container } = render(() => (
      <EntityEmailParticipants
        entity={emailEntity([{ email: 'wolf@macro.com' }])}
      />
    ));

    expect(container.textContent).toBe('Wolf Ryan');
  });

  it('falls back to the address local part when neither source has a name', () => {
    const { container } = render(() => (
      <EntityEmailParticipants
        entity={emailEntity([{ email: 'someone@example.com' }])}
      />
    ));

    expect(container.textContent).toBe('someone');
  });

  it('ignores names that are just an email address', () => {
    const { container } = render(() => (
      <EntityEmailParticipants
        entity={emailEntity([
          { email: 'notifications@cal.com', name: 'notifications@cal.com' },
        ])}
      />
    ));

    expect(container.textContent).toBe('Nathan Flurry');
  });
});
