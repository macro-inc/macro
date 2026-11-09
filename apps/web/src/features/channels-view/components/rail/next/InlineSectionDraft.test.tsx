import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { InlineSectionDraft } from './InlineSectionDraft';

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isPending: false,
    isEnabled: true,
    data: undefined,
  }),
}));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

afterEach(cleanup);

it('saves the inline name without submitting the initial empty draft', async () => {
  const save = vi.fn(async () => {});
  render(() => (
    <InlineSectionDraft
      scope="personal"
      canShare
      onSave={save}
      onCancel={() => {}}
    />
  ));
  const input = screen.getByRole('textbox', { name: 'Section name' });
  expect(
    screen
      .getByRole('button', { name: 'Save section' })
      .hasAttribute('disabled')
  ).toBe(true);
  fireEvent.input(input, { target: { value: '  Release planning  ' } });
  fireEvent.submit(input.closest('form')!);
  expect(save).toHaveBeenCalledExactlyOnceWith({
    name: 'Release planning',
    scope: 'personal',
  });
});

it('replaces team visibility with Only me instead of accumulating scopes', async () => {
  const save = vi.fn(async () => {});
  render(() => (
    <InlineSectionDraft
      scope="team"
      canShare
      teamName="Workspace"
      onSave={save}
      onCancel={() => {}}
    />
  ));
  fireEvent.input(screen.getByRole('textbox', { name: 'Section name' }), {
    target: { value: 'Planning' },
  });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Visible to' }), {
    key: 'ArrowDown',
  });
  const onlyMe = await screen.findByRole('menuitemcheckbox', {
    name: 'Only me',
  });
  const workspace = screen.getByRole('menuitemcheckbox', { name: 'Workspace' });
  fireEvent.keyDown(onlyMe, { key: 'Enter' });
  expect(onlyMe.getAttribute('aria-checked')).toBe('true');
  expect(workspace.getAttribute('aria-checked')).toBe('false');
  expect(save).not.toHaveBeenCalled();
});

it('cancels on Escape without saving', () => {
  const save = vi.fn(async () => {});
  const cancel = vi.fn();
  render(() => (
    <InlineSectionDraft
      scope="personal"
      canShare={false}
      onSave={save}
      onCancel={cancel}
    />
  ));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Section name' }), {
    key: 'Escape',
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});
