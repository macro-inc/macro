import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const document = vi.hoisted(() => ({ kind: 'skill' as string }));
const save = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'skill-1',
    kind: () => document.kind,
    permissions: { canEdit: () => true },
  }),
}));

vi.mock('@queries/storage/skill-description', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@queries/storage/skill-description')
  >()),
  useSkillDescriptionQuery: () => ({
    isSuccess: true,
    isPending: false,
    data: 'Use when drafting release notes',
  }),
  useSetSkillDescription: () => save,
}));

import { SkillDescriptionField } from './SkillDescriptionField';

beforeEach(() => {
  document.kind = 'skill';
  save.mutate.mockReset();
});
afterEach(cleanup);

function field() {
  return screen.getByLabelText('When to use this skill') as HTMLInputElement;
}

it('shows the stored description under a skill title', () => {
  render(() => <SkillDescriptionField />);
  expect(field().value).toBe('Use when drafting release notes');
});

it('rejects a line without "Use when" and saves nothing', () => {
  render(() => <SkillDescriptionField />);
  fireEvent.input(field(), { target: { value: 'Drafts release notes' } });
  fireEvent.blur(field());

  expect(
    screen.getByText('Start the description with "Use when".')
  ).toBeTruthy();
  expect(save.mutate).not.toHaveBeenCalled();
});

it('saves a changed description on blur', () => {
  render(() => <SkillDescriptionField />);
  fireEvent.input(field(), {
    target: { value: ' Use when drafting release notes; not changelogs ' },
  });
  fireEvent.blur(field());

  expect(save.mutate).toHaveBeenCalledWith(
    'Use when drafting release notes; not changelogs',
    expect.anything()
  );
});

it('renders nothing for documents that are not skills', () => {
  document.kind = 'task';
  render(() => <SkillDescriptionField />);
  expect(screen.queryByLabelText('When to use this skill')).toBeNull();
});
