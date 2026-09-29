import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Targets resolve again once refs are inserted; let that settle. */
const settle = () => Promise.resolve();

import {
  defineTourTargets,
  resolveTourTarget,
  Tour,
  type TourStep,
  tourTarget,
  useTour,
} from '.';

const T = defineTourTargets('test', [
  'first',
  'second',
  'entry',
  'hidden',
  'toggle',
  'row',
]);
const APP = defineTourTargets('test-app', ['menu'], { scope: 'app' });

// jsdom has no layout; give every element a box so it counts as shown.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 10, 100, 20)
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Card() {
  return (
    <>
      <Tour.Title />
      <Tour.Description />
      <Tour.Progress />
      <Tour.Previous />
      <Tour.Next doneLabel="Done" />
      <Tour.Close />
    </>
  );
}

const status = () =>
  document.querySelector('[data-tour-popover]')?.getAttribute('data-status');

describe('defineTourTargets', () => {
  it('namespaces ids and records scope', () => {
    expect(T.first.id).toBe('test.first');
    expect(T.first.scope).toBe('view');
    expect(APP.menu.scope).toBe('app');
  });
});

describe('resolveTourTarget', () => {
  it('prefers earlier targets and keeps view targets inside the boundary', () => {
    const [inside, setInside] = createSignal(true);
    let boundary!: HTMLDivElement;
    render(() => (
      <>
        <div ref={boundary}>
          <Show when={inside()}>
            <span data-testid="inside" ref={tourTarget(T.second)} />
          </Show>
        </div>
        <span data-testid="outside" ref={tourTarget(T.first)} />
        <span data-testid="menu" ref={tourTarget(APP.menu)} />
      </>
    ));
    expect(resolveTourTarget([T.first, T.second], boundary)).toBe(
      screen.getByTestId('inside')
    );
    expect(resolveTourTarget([T.first], undefined)).toBe(
      screen.getByTestId('outside')
    );
    expect(resolveTourTarget([APP.menu], boundary)).toBe(
      screen.getByTestId('menu')
    );
    setInside(false);
    expect(resolveTourTarget([T.second], boundary)).toBeUndefined();
  });

  it('skips targets inside inert or hidden subtrees', () => {
    render(() => (
      <div inert>
        <span ref={tourTarget(T.hidden)} />
      </div>
    ));
    expect(resolveTourTarget([T.hidden], undefined)).toBeUndefined();
  });
});

describe('Tour', () => {
  const steps: TourStep[] = [
    { target: T.first, title: 'First', description: 'One' },
    { target: T.second, title: 'Second', description: 'Two' },
  ];

  it('steps through and completes on the last step', async () => {
    const onComplete = vi.fn();
    render(() => (
      <>
        <span ref={tourTarget(T.first)} />
        <span ref={tourTarget(T.second)} />
        <Tour.Root steps={steps} onComplete={onComplete}>
          <Tour.Popover>
            <Card />
          </Tour.Popover>
        </Tour.Root>
      </>
    ));
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'First' });
    expect(dialog.textContent).toContain('1 / 2');
    expect(status()).toBe('anchored');
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(screen.getByRole('dialog', { name: 'First' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('dismisses from the close button and Escape', () => {
    const onDismiss = vi.fn();
    render(() => (
      <Tour.Root steps={steps} onDismiss={onDismiss}>
        <Tour.Popover>
          <Card />
        </Tour.Popover>
      </Tour.Root>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tour' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('floats when the target is missing and there is no entry', () => {
    render(() => (
      <Tour.Root steps={steps}>
        <Tour.Popover>
          <Card />
        </Tour.Popover>
      </Tour.Root>
    ));
    expect(status()).toBe('floating');
  });

  it('waits on the entry instead of navigating, and resumes when pressed or when the target appears', async () => {
    const [shown, setShown] = createSignal(false);
    const waiting: TourStep[] = [
      {
        target: T.hidden,
        entry: T.entry,
        entryLabel: 'Open settings to continue',
        title: 'Hidden',
        description: 'Behind the entry',
      },
    ];
    render(() => (
      <>
        <button type="button" ref={tourTarget(T.entry)}>
          Settings
        </button>
        <Show when={shown()}>
          <span ref={tourTarget(T.hidden)} />
        </Show>
        <Tour.Root steps={waiting}>
          <Tour.Beacon />
          <Tour.Popover>
            <Card />
          </Tour.Popover>
        </Tour.Root>
      </>
    ));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-tour-beacon]')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'Open settings to continue'
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Settings' }));
    expect(document.querySelector('[data-tour-beacon]')).toBeNull();
    expect(status()).toBe('floating');

    setShown(true);
    await settle();
    expect(status()).toBe('anchored');

    // Leaving again brings the beacon back.
    setShown(false);
    await settle();
    expect(document.querySelector('[data-tour-beacon]')).toBeTruthy();
  });

  it('falls back through entries and says what to press', async () => {
    const [expanded, setExpanded] = createSignal(false);
    const onComplete = vi.fn();
    render(() => (
      <>
        <button type="button" ref={tourTarget(T.toggle)}>
          Show sidebar
        </button>
        <Show when={expanded()}>
          <button type="button" ref={tourTarget(T.entry)}>
            Settings
          </button>
        </Show>
        <Tour.Root
          steps={[
            {
              target: T.hidden,
              entry: [T.entry, T.toggle],
              entryLabel: 'Open settings to continue',
              title: 'Hidden',
              description: 'Behind two steps',
            },
          ]}
          onComplete={onComplete}
        >
          <Tour.Beacon />
          <Tour.Hint>
            <span>Open settings to continue</span>
            <Tour.Next>Skip</Tour.Next>
          </Tour.Hint>
        </Tour.Root>
      </>
    ));
    await settle();
    const hint = () => document.querySelector('[data-tour-hint]');
    expect(hint()?.textContent).toContain('Open settings to continue');

    // The sidebar opening swaps the beacon to the real entry.
    setExpanded(true);
    await settle();
    expect(hint()).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('points at the top-most element when several share a target', () => {
    const tops = new Map<string, number>([
      ['low', 200],
      ['high', 40],
    ]);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return new DOMRect(
          0,
          tops.get(this.dataset.testid ?? '') ?? 0,
          100,
          20
        );
      }
    );
    render(() => (
      <>
        <span data-testid="low" ref={tourTarget(T.row)} />
        <span data-testid="high" ref={tourTarget(T.row)} />
      </>
    ));
    expect(resolveTourTarget([T.row], undefined)).toBe(
      screen.getByTestId('high')
    );
  });

  it('reports when a step is anchored to a fallback target', async () => {
    let tour!: ReturnType<typeof useTour>;
    function Probe() {
      tour = useTour();
      return null;
    }
    render(() => (
      <>
        <span ref={tourTarget(T.second)} />
        <Tour.Root
          steps={[
            {
              target: [T.first, T.second],
              title: 'Fallback',
              description: 'Primary missing',
            },
          ]}
        >
          <Probe />
        </Tour.Root>
      </>
    ));
    await settle();
    expect(tour.status()).toBe('anchored');
    expect(tour.isFallback()).toBe(true);
  });

  it('skips the run of steps that wait on the same entry', () => {
    let tour!: ReturnType<typeof useTour>;
    function Probe() {
      tour = useTour();
      return null;
    }
    const shared = { entry: T.entry };
    render(() => (
      <Tour.Root
        steps={[
          { ...shared, target: T.first, title: '1', description: '' },
          { ...shared, target: T.second, title: '2', description: '' },
          { target: T.hidden, title: '3', description: '' },
        ]}
      >
        <Probe />
      </Tour.Root>
    ));
    expect(tour.pathEnd()).toBe(1);
    tour.skipPath();
    expect(tour.index()).toBe(2);
    expect(tour.pathEnd()).toBe(2);
  });

  it('renders the same parts inline with Tour.Panel', () => {
    render(() => (
      <Tour.Root steps={steps}>
        <Tour.Panel>
          <Card />
        </Tour.Panel>
      </Tour.Root>
    ));
    expect(screen.getByRole('region', { name: 'First' })).toBeTruthy();
  });
});
