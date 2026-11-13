/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type LexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { UserMention } from './UserMention';

const AGENT = 'macro|agent@example.com';

const mocks = vi.hoisted(() => ({
  clickedSurface: vi.fn<(surface: string | undefined) => void>(),
}));

// Stand in for the card trigger: report where a click on it would open an
// agent's profile from, read at click time like the real trigger.
vi.mock('@core/component/UserCardTrigger', () => ({
  UserCardTrigger: (props: { profileSurface?: string; trigger: unknown }) => (
    <button
      type="button"
      onClick={() => mocks.clickedSurface(props.profileSurface)}
    >
      @Ops
    </button>
  ),
}));

vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  macroIdToEmail: () => 'agent@example.com',
  getDisplayNameParts: () => ({ firstName: 'Ops', fullName: 'Ops' }),
}));

afterEach(() => {
  cleanup();
  mocks.clickedSurface.mockClear();
});

function renderMention(editable: boolean | undefined) {
  const wrapper =
    editable === undefined
      ? undefined
      : ({
          editor: {
            isEditable: () => editable,
            dispatchCommand: () => true,
          },
        } as unknown as LexicalWrapper);
  render(() => (
    <LexicalWrapperContext.Provider value={wrapper}>
      <UserMention
        key="node-1"
        userId={AGENT}
        email="agent@example.com"
        displayName="Ops"
        theme={{}}
      />
    </LexicalWrapperContext.Provider>
  ));
  fireEvent.click(screen.getByRole('button', { name: '@Ops' }));
}

it("opens an agent's profile from a read-only mention", () => {
  renderMention(false);
  expect(mocks.clickedSurface).toHaveBeenCalledWith('mention');
});

it('opens it from a mention outside any editor', () => {
  renderMention(undefined);
  expect(mocks.clickedSurface).toHaveBeenCalledWith('mention');
});

it('leaves a click in an editable editor to place the caret', () => {
  renderMention(true);
  expect(mocks.clickedSurface).toHaveBeenCalledWith(undefined);
});
