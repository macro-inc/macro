import { CatalogMutationError } from '@queries/properties/catalog/errors';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tags } from './Tags';

const mocks = vi.hoisted(() => ({
  promote: undefined as undefined | (() => Promise<unknown>),
}));

const PERSONAL: TagSetResponse = {
  scope: 'user',
  definition: { id: 'def-user' } as TagSetResponse['definition'],
  options: [
    {
      id: 'opt-1',
      propertyDefinitionId: 'def-user',
      displayOrder: 0,
      value: { type: 'string', value: 'Urgent' },
    } as TagSetResponse['options'][number],
  ],
};

vi.mock('@property/tags/TagEditorDialog', () => ({
  TagEditorDialog: () => null,
}));
vi.mock('@property/tags/use-tag-team-sharing-flag', () => ({
  useTagTeamSharingFlag: () => () => true,
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: { team: { name: 'Acme' } } }),
}));
vi.mock('@queries/properties/tags', async () => {
  const { createCatalogMutation: catalogMutation } = await import(
    '@queries/properties/catalog/mutation'
  );
  const idle = () => catalogMutation(() => Promise.resolve(undefined), {});
  return {
    parseTagNameConflict: () => undefined,
    useTagsQuery: () => ({ data: [PERSONAL] }),
    useDeletePropertyOptionMutation: idle,
    useMergeTagMutation: idle,
    usePromoteTagMutation: () =>
      catalogMutation(() => mocks.promote?.() ?? Promise.resolve(), {}),
  };
});

// A closed dialog stays mounted, marked closed, until its exit animation ends.
const confirmationOpen = () => {
  const dialog = screen.queryByRole('dialog');
  return dialog !== null && !dialog.hasAttribute('data-closed');
};

beforeEach(() => {
  // The dialog restores the page's scroll as it closes.
  vi.stubGlobal('scrollTo', () => {});
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.promote = undefined;
});

it.each(['SIGNED_OUT', 'ACCOUNT_CHANGED'])(
  'closes the share confirmation when the share is dropped as %s',
  async (code) => {
    mocks.promote = () =>
      Promise.reject(new CatalogMutationError('dropped', code));
    render(() => <Tags />);

    await fireEvent.click(
      screen.getByRole('button', { name: 'Share Urgent with team' })
    );
    expect(await screen.findByText(/moves into the Acme team/)).toBeTruthy();
    expect(confirmationOpen()).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await vi.waitFor(() => expect(confirmationOpen()).toBe(false));
  }
);

it('closes the share confirmation once the share commits', async () => {
  mocks.promote = () => Promise.resolve({ ok: true });
  render(() => <Tags />);
  await fireEvent.click(
    screen.getByRole('button', { name: 'Share Urgent with team' })
  );
  expect(await screen.findByText(/moves into the Acme team/)).toBeTruthy();
  expect(confirmationOpen()).toBe(true);
  await fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  await vi.waitFor(() => expect(confirmationOpen()).toBe(false));
});
