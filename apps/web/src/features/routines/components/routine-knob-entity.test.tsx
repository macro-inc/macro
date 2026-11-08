import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Knob, withKnobValue } from '../core/knobs';
import { StepSentence } from './routine-step-knobs';

const touch = { value: false };
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => touch.value,
}));
const NAMES: Record<string, string> = { c1: 'bug-reports', c2: 'triage' };
vi.mock('@property/hooks', () => ({
  usePropertyEntityDisplay: (id: Accessor<string>) => ({
    name: () => NAMES[id()] ?? 'Unknown',
    icon: () => <span data-testid="channel-icon" />,
  }),
}));
// The app's entity picker, standing in with the channel it would offer.
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: (props: {
    config: { specificEntityType: string };
    setSelectedOptions(
      ids: Set<string>,
      info: { id: string; entity_type: string; name: string }[]
    ): void;
  }) => (
    <button
      type="button"
      onClick={() =>
        props.setSelectedOptions(new Set(['c2']), [
          { id: 'c2', entity_type: 'CHANNEL', name: 'triage' },
        ])
      }
    >
      {`Pick triage (${props.config.specificEntityType})`}
    </button>
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  touch.value = false;
  // The touch sheet measures itself and locks scrolling.
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bugs: Knob = {
  type: 'entity',
  name: 'bugs',
  label: 'Channel to post in',
  entity_types: ['channel'],
  value: { type: 'channel', id: 'c1' },
};

function renderSentence(knob: Knob) {
  const [current, setCurrent] = createSignal([knob]);
  render(() => (
    <StepSentence
      sentence="Post open bugs in {bugs}."
      knobs={current()}
      onKnob={(name, value) =>
        setCurrent(withKnobValue(current(), name, value))
      }
    />
  ));
  return current;
}

describe('an entity knob', () => {
  it('shows the picked channel by name and swaps it from the entity picker', async () => {
    const current = renderSentence(bugs);
    expect(screen.getByText(/Post open bugs in/).textContent).toBe(
      'Post open bugs in bug-reports.'
    );
    expect(screen.getByTestId('channel-icon')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Channel to post in: change it' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pick triage (CHANNEL)' })
    );
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c2' },
    });
    expect(screen.getByText(/Post open bugs in/).textContent).toBe(
      'Post open bugs in triage.'
    );
  });

  it('asks for a channel when a starter has none, and on touch picks only on Done', async () => {
    touch.value = true;
    const current = renderSentence({ ...bugs, value: null });
    expect(screen.getByText(/Post open bugs in/).textContent).toBe(
      'Post open bugs in Pick a channel.'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Channel to post in: pick a channel' })
    );
    // The sheet shows its list once it has slid in.
    const sheet = document.querySelector<HTMLElement>(
      '[data-corvu-drawer-content]'
    )!;
    fireEvent(sheet, new Event('transitionend'));
    fireEvent.click(await screen.findByText('Pick triage (CHANNEL)'));
    expect(current()[0]).toMatchObject({ value: null });
    fireEvent.click(screen.getByText('Done'));
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c2' },
    });
  });
});
