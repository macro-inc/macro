import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Knob, withKnobValue } from '../core/knobs';
import { KnobSettings, StepSentence } from './routine-step-knobs';

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
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => ({
      items: () => [
        { id: 'db1', data: { name: 'Bugs' } },
        { id: 'db2', data: { name: 'Hiring' } },
      ],
    }),
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
    <>
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
      {/* What it reports for a click or Enter on the row already picked. */}
      <button
        type="button"
        onClick={() =>
          props.setSelectedOptions(new Set(), [
            { id: 'c2', entity_type: 'CHANNEL', name: 'triage' },
          ])
        }
      >
        Pick triage again
      </button>
    </>
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

function renderSentence(knob: Knob, sentence = 'Post open bugs in {bugs}.') {
  const [current, setCurrent] = createSignal([knob]);
  render(() => (
    <StepSentence
      sentence={sentence}
      knobs={current()}
      onKnob={(name, value) =>
        setCurrent(withKnobValue(current(), name, value))
      }
    />
  ));
  return current;
}

const sentence = () => screen.getByText(/Post open bugs in/).textContent;

describe('an entity knob', () => {
  it('shows the picked channel by name and swaps it only on Save', async () => {
    const current = renderSentence(bugs);
    expect(sentence()).toBe('Post open bugs in bug-reports.');
    expect(screen.getByTestId('channel-icon')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Channel to post in: the chosen channel. Change it',
      })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pick triage (CHANNEL)' })
    );
    // A pick is a draft: neither it nor Enter saves.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c2' },
    });
    expect(sentence()).toBe('Post open bugs in triage.');
  });

  it('clears to pick another, and Cancel keeps the saved channel', async () => {
    const current = renderSentence(bugs);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Channel to post in: the chosen channel. Change it',
      })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Pick a channel.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    // Picking another makes it savable again.
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick triage (CHANNEL)' })
    );
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    fireEvent.click(screen.getByText('Cancel'));
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c1' },
    });
    expect(sentence()).toBe('Post open bugs in bug-reports.');
  });

  it('keeps a pick when its row is picked again, as Enter on it does', async () => {
    const current = renderSentence(bugs);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Channel to post in: the chosen channel. Change it',
      })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pick triage (CHANNEL)' })
    );
    // Only Clear empties the draft.
    fireEvent.click(screen.getByRole('button', { name: 'Pick triage again' }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c2' },
    });
  });

  it('shows a starter’s unpicked channel as still to set', async () => {
    const current = renderSentence({ ...bugs, value: null });
    expect(sentence()).toBe('Post open bugs in Channel to post in.');
    const trigger = screen.getByRole('button', {
      name: 'Channel to post in: not set. Set it',
    });
    expect(trigger.className).toContain('decoration-dashed');
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pick triage (CHANNEL)' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c2' },
    });
  });

  it('reads Not set beside its label in Settings', () => {
    render(() => (
      <KnobSettings knobs={[{ ...bugs, value: null }]} onKnob={() => {}} />
    ));
    expect(
      screen.getByRole('button', {
        name: 'Channel to post in: not set. Set it',
      }).textContent
    ).toBe('Not set');
  });

  it('picks a database from the ones the owner has', async () => {
    const current = renderSentence(
      {
        type: 'entity',
        name: 'bugs',
        label: 'Database to log in',
        entity_types: ['database'],
        value: { type: 'database', id: 'db1' },
      },
      'Post open bugs in {bugs}.'
    );
    expect(sentence()).toBe('Post open bugs in Bugs.');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Database to log in: the chosen database. Change it',
      })
    );
    fireEvent.input(
      await screen.findByRole('textbox', { name: 'Find a database' }),
      { target: { value: 'hir' } }
    );
    expect(screen.queryByRole('radio', { name: 'Bugs' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Hiring' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current()[0]).toMatchObject({
      value: { type: 'database', id: 'db2' },
    });
    expect(sentence()).toBe('Post open bugs in Hiring.');
  });

  it('on touch picks in a sheet, only on Done, and clears there', async () => {
    touch.value = true;
    const current = renderSentence(bugs);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Channel to post in: the chosen channel. Change it',
      })
    );
    // The sheet shows its list once it has slid in.
    const sheet = document.querySelector<HTMLElement>(
      '[data-corvu-drawer-content]'
    )!;
    fireEvent(sheet, new Event('transitionend'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(
      (screen.getByText('Done').closest('button') as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(await screen.findByText('Pick triage (CHANNEL)'));
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c1' },
    });
    fireEvent.click(screen.getByText('Done'));
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c2' },
    });
  });

  it('on touch drops a pick on Cancel, and reopens on the saved channel', async () => {
    touch.value = true;
    const current = renderSentence(bugs);
    const open = () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Channel to post in: the chosen channel. Change it',
        })
      );
      const sheet = document.querySelector<HTMLElement>(
        '[data-corvu-drawer-content]'
      )!;
      fireEvent(sheet, new Event('transitionend'));
    };
    open();
    fireEvent.click(await screen.findByText('Pick triage (CHANNEL)'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c1' },
    });
    // The dropped pick doesn't come back: Done saves what was saved.
    open();
    fireEvent.click(screen.getByText('Done'));
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c1' },
    });
  });
});

const GONE =
  'The channel picked for "Channel to post in" was deleted or you no longer have access to it. Pick another in the routine\'s settings.';

describe('an entity knob whose item its owner can no longer use', () => {
  function renderGone(knob: Knob = bugs) {
    const [current, setCurrent] = createSignal([knob]);
    render(() => (
      <StepSentence
        sentence="Post open bugs in {bugs}."
        knobs={current()}
        onKnob={(name, value) =>
          setCurrent(withKnobValue(current(), name, value))
        }
        unusable={[
          {
            step: 'post-open-bugs',
            knob: 'bugs',
            item: { type: 'channel', id: 'c1' },
            reason: GONE,
          },
        ]}
      />
    ));
    return current;
  }

  it('shows as needing a new pick, says why, and saves only another', async () => {
    const current = renderGone();
    expect(sentence()).toBe('Post open bugs in Channel to post in.');
    const trigger = screen.getByRole('button', {
      name: 'Channel to post in: needs a new pick. Set it',
    });
    expect(trigger.className).toContain('decoration-dashed');
    expect(trigger.className).toContain('text-failure');
    fireEvent.click(trigger);
    expect(await screen.findByText(GONE)).toBeTruthy();
    const save = () =>
      screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick triage (CHANNEL)' })
    );
    expect(screen.queryByText(GONE)).toBeNull();
    fireEvent.click(save());
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c2' },
    });
    expect(sentence()).toBe('Post open bugs in triage.');
  });

  it('shows another knob’s usable item as picked', () => {
    renderGone({ ...bugs, value: { type: 'channel', id: 'c2' } });
    expect(sentence()).toBe('Post open bugs in triage.');
  });

  it('reads Needs a new pick beside its label in Settings', () => {
    render(() => (
      <KnobSettings
        knobs={[bugs]}
        onKnob={() => {}}
        unusable={[
          {
            step: 'post-open-bugs',
            knob: 'bugs',
            item: { type: 'channel', id: 'c1' },
            reason: GONE,
          },
        ]}
      />
    ));
    expect(
      screen.getByRole('button', {
        name: 'Channel to post in: needs a new pick. Set it',
      }).textContent
    ).toBe('Needs a new pick');
  });

  it('on touch says why in the sheet and keeps Done off until another pick', async () => {
    touch.value = true;
    const current = renderGone();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Channel to post in: needs a new pick. Set it',
      })
    );
    const sheet = document.querySelector<HTMLElement>(
      '[data-corvu-drawer-content]'
    )!;
    fireEvent(sheet, new Event('transitionend'));
    expect(await screen.findByText(GONE)).toBeTruthy();
    const done = () =>
      screen.getByText('Done').closest('button') as HTMLButtonElement;
    expect(done().disabled).toBe(true);
    fireEvent.click(screen.getByText('Pick triage (CHANNEL)'));
    expect(done().disabled).toBe(false);
    fireEvent.click(done());
    expect(current()[0]).toMatchObject({
      value: { type: 'channel', id: 'c2' },
    });
  });
});
