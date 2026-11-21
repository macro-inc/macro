import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { FaceEditor } from '../components/face-editor';
import { createFaceDraft } from '../primitives/create-face-draft';

afterEach(cleanup);

const suggestionButtons = () =>
  screen.getAllByRole('button', { name: /^Face \d$/ });

it('chooses a suggested face, and keeps it chosen through New faces', () => {
  let draft!: ReturnType<typeof createFaceDraft>;
  render(() => {
    draft = createFaceDraft({ v: 1, seed: 'start', pins: { hair: 2 } });
    return <FaceEditor draft={draft} initials="A" />;
  });

  expect(suggestionButtons()).toHaveLength(8);
  // The starting face isn't one of the suggestions.
  for (const button of suggestionButtons())
    expect(button.getAttribute('aria-pressed')).toBe('false');

  const third = screen.getByRole('button', { name: 'Face 3' });
  fireEvent.click(third);
  expect(third.getAttribute('aria-pressed')).toBe('true');
  const chosen = draft.face();
  expect(chosen.seed).not.toBe('start');

  fireEvent.click(screen.getByRole('button', { name: 'New faces' }));
  expect(draft.face()).toEqual(chosen);
  expect(suggestionButtons()).toHaveLength(8);
  // Eight new faces; the chosen one is no longer among them.
  for (const button of suggestionButtons())
    expect(button.getAttribute('aria-pressed')).toBe('false');
});

it('marks only Any as pressed while a part is unpinned, and only the pin once pinned', () => {
  render(() => {
    const draft = createFaceDraft({ v: 1, seed: 'start', pins: {} });
    return <FaceEditor draft={draft} initials="A" />;
  });
  const skinOptions = () =>
    screen.getAllByRole('button', { name: /^Skin \d+$/ });

  // The face still resolves to some skin, but that option isn't a selection.
  expect(
    screen
      .getByRole('button', { name: 'Any Skin' })
      .getAttribute('aria-pressed')
  ).toBe('true');
  for (const option of skinOptions())
    expect(option.getAttribute('aria-pressed')).toBe('false');

  fireEvent.click(screen.getByRole('button', { name: 'Skin 3' }));
  expect(
    screen
      .getByRole('button', { name: 'Any Skin' })
      .getAttribute('aria-pressed')
  ).toBe('false');
  expect(
    skinOptions()
      .filter((option) => option.getAttribute('aria-pressed') === 'true')
      .map((option) => option.getAttribute('aria-label'))
  ).toEqual(['Skin 3']);
});
