import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StepSentence } from './routine-step-knobs';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@property/hooks', () => ({
  usePropertyEntityDisplay: () => ({ name: () => '', icon: () => null }),
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => ({
      items: () =>
        Array.from({ length: 2000 }, (_, index) => ({
          id: `db${index}`,
          data: { name: `Database ${index}` },
        })),
    }),
  }),
}));
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: () => null,
}));

// The layout jsdom lacks and the virtualizer reads.
class LayoutResizeObserver implements ResizeObserver {
  constructor(private readonly notify: ResizeObserverCallback) {}
  observe(target: Element) {
    const height = target.matches('.overflow-y-auto') ? 192 : 28;
    this.notify(
      [{ target, contentRect: { height, width: 320 } } as ResizeObserverEntry],
      this
    );
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', LayoutResizeObserver);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.parentElement;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('mounts only the databases in view, and the picked one with its neighbors', async () => {
  render(() => (
    <StepSentence
      sentence="Log in {bugs}."
      knobs={[
        {
          type: 'entity',
          name: 'bugs',
          label: 'Database',
          entity_types: ['database'],
          value: { type: 'database', id: 'db1200' },
        },
      ]}
      onKnob={() => {}}
    />
  ));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Database: the chosen database. Change it',
    })
  );
  await screen.findByRole('radio', { name: 'Database 0' });
  const radios = screen.getAllByRole('radio');
  expect(radios.length).toBeGreaterThan(5);
  expect(radios.length).toBeLessThan(40);
  // The radios the arrow keys reach from the picked one.
  for (const index of [1199, 1200, 1201])
    expect(
      screen.getByRole('radio', { name: `Database ${index}` })
    ).toBeTruthy();
});
