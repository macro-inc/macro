import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { UserRuntimes } from './UserRuntimes';

vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessDirectoryQuery: () => ({
    isSuccess: true,
    data: [
      {
        id: 'a',
        name: 'Open to me',
        owner: { type: 'user', user_id: 'macro|teammate@x.test' },
        access: 'user',
        connected: true,
      },
      {
        id: 'b',
        name: 'Closed to me',
        owner: { type: 'user', user_id: 'macro|teammate@x.test' },
        access: 'none',
        connected: false,
      },
      {
        id: 'c',
        name: 'Readable',
        owner: { type: 'user', user_id: 'macro|teammate@x.test' },
        access: 'read',
        connected: true,
      },
      {
        id: 'd',
        name: 'Someone else',
        owner: { type: 'user', user_id: 'macro|other@x.test' },
        access: 'none',
        connected: true,
      },
    ],
  }),
}));
vi.mock('../components/RuntimeAccessAction', () => ({
  RuntimeAccessAction: (props: { harnessId: string }) => (
    <button type="button">request {props.harnessId}</button>
  ),
}));

describe('UserRuntimes', () => {
  it('lists that person’s runtimes and offers access only where it is missing', () => {
    render(() => <UserRuntimes userId="macro|teammate@x.test" />);

    expect(screen.getByText('Open to me')).toBeTruthy();
    expect(screen.getByText('Closed to me')).toBeTruthy();
    expect(screen.queryByText('Someone else')).toBeNull();
    expect(screen.queryByRole('button', { name: 'request a' })).toBeNull();
    expect(screen.getByRole('button', { name: 'request b' })).toBeTruthy();
    // A reader can see it but cannot run agents on it, so can still ask.
    expect(screen.getByRole('button', { name: 'request c' })).toBeTruthy();
    expect(screen.getByText(/Online · Read/)).toBeTruthy();
  });

  it('shows nothing for someone with no runtimes', () => {
    const { container } = render(() => (
      <UserRuntimes userId="macro|nobody@x.test" />
    ));
    expect(container.textContent).toBe('');
  });
});
