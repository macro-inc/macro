import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { PollBars } from './poll-bars';

afterEach(cleanup);

const bars = [
  { optionId: 'tacos', label: 'Tacos', count: 3, percent: 75, mine: false },
  { optionId: 'pho', label: 'Pho', count: 1, percent: 25, mine: true },
  { optionId: 'salad', label: 'Salad', count: 0, percent: 0, mine: false },
];

it('is one tab stop: arrows move between options, Space votes, and the note says why counts are missing', () => {
  const votes: string[] = [];
  render(() => (
    <PollBars
      question="Lunch?"
      bars={bars}
      showResults={false}
      hiddenNote="Loading results…"
      multi={false}
      disabled={false}
      summary=""
      onVote={(optionId) => votes.push(optionId)}
    />
  ));
  const [tacos, pho, salad] = screen.getAllByRole('radio');
  expect([tacos.tabIndex, pho.tabIndex, salad.tabIndex]).toEqual([-1, 0, -1]);
  pho.focus();
  fireEvent.keyDown(pho, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(salad);
  fireEvent.keyDown(salad, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(tacos);
  expect(votes).toEqual([]);
  // Space or Enter on a focused button activates it, as a click.
  fireEvent.click(tacos);
  expect(votes).toEqual(['tacos']);
  expect(screen.getByText('Loading results…')).toBeTruthy();
  expect(screen.queryByText('Results are hidden.')).toBeNull();
});

it('keeps the focused option mounted when live counts and the saved vote refresh', async () => {
  const [pending, setPending] = createSignal(false);
  const [options, setOptions] = createSignal([
    { optionId: 'tacos', label: 'Tacos', count: 0, percent: 0, mine: false },
    { optionId: 'pho', label: 'Pho', count: 1, percent: 100, mine: true },
  ]);
  const votes: string[] = [];
  const user = userEvent.setup();
  render(() => (
    <PollBars
      question="Lunch?"
      bars={options()}
      showResults
      hiddenNote=""
      multi={false}
      disabled={false}
      pending={pending()}
      summary="1 vote"
      onVote={(optionId) => votes.push(optionId)}
    />
  ));
  const tacos = screen.getByRole('radio', { name: 'Tacos 0 votes' });
  tacos.focus();
  setPending(true);
  // Native disabled blurs a focused button in Chromium; aria-disabled keeps
  // its place while a save is pending, without accepting another vote.
  expect(tacos.hasAttribute('disabled')).toBe(false);
  expect(tacos.getAttribute('aria-disabled')).toBe('true');
  await user.keyboard(' ');
  expect(votes).toEqual([]);
  setPending(false);
  setOptions([
    { optionId: 'tacos', label: 'Tacos', count: 1, percent: 100, mine: true },
    { optionId: 'pho', label: 'Pho', count: 0, percent: 0, mine: false },
  ]);
  expect(document.activeElement).toBe(tacos);
  expect(tacos.getAttribute('aria-checked')).toBe('true');
  expect(tacos.textContent).toContain('1');
  await user.keyboard('{ArrowDown} ');
  expect(votes).toEqual(['pho']);
});

it('keeps arrow navigation and Enter and Space votes inside a poll hosted in a channel hotkey scope', async () => {
  const channelNavigation = vi.fn(() => true);
  const channelReply = vi.fn(() => true);
  const votes: string[] = [];
  const user = userEvent.setup();
  render(() => {
    useHotKeyRoot();
    const [attachChannelScope, channelScope] = useHotkeyDOMScope('channel');
    registerHotkey({
      scopeId: channelScope,
      hotkey: ['arrowup', 'arrowdown'],
      description: 'Select message',
      keyDownHandler: channelNavigation,
    });
    registerHotkey({
      scopeId: channelScope,
      hotkey: 'enter',
      description: 'Reply to message',
      keyDownHandler: channelReply,
    });
    return (
      <div ref={attachGlobalDOMScope}>
        <div ref={attachChannelScope}>
          <PollBars
            question="Lunch?"
            bars={[
              {
                optionId: 'tacos',
                label: 'Tacos',
                count: 0,
                percent: 0,
                mine: false,
              },
              {
                optionId: 'pho',
                label: 'Pho',
                count: 1,
                percent: 100,
                mine: true,
              },
            ]}
            showResults
            hiddenNote=""
            multi={false}
            disabled={false}
            summary="1 vote"
            onVote={(optionId) => votes.push(optionId)}
          />
        </div>
      </div>
    );
  });

  const [tacos, pho] = screen.getAllByRole('radio');
  pho.focus();
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(tacos);
  expect(votes).toEqual([]);
  await user.keyboard('{Enter}');
  expect(votes).toEqual(['tacos']);
  await user.keyboard('{ArrowUp}');
  expect(document.activeElement).toBe(pho);
  await user.keyboard(' ');
  expect(votes).toEqual(['tacos', 'pho']);
  expect(channelNavigation).not.toHaveBeenCalled();
  expect(channelReply).not.toHaveBeenCalled();
});
