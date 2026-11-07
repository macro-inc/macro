import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentsEnabled: false,
  read: (): { enabled: boolean; loading: boolean } => ({
    enabled: true,
    loading: false,
  }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () =>
    flag.key === 'enable-macro-computers'
      ? mocks.read()
      : { enabled: mocks.agentsEnabled, loading: false },
}));
beforeEach(() => {
  mocks.agentsEnabled = false;
  mocks.read = () => ({ enabled: true, loading: false });
});

import {
  SettingsScreenNavigationProvider,
  useSettingsScreenNavigation,
} from './settings-screen-navigation';

function Selection(props: { label: string }) {
  const navigation = useSettingsScreenNavigation();
  return (
    <section aria-label={props.label}>
      <button onClick={() => navigation.request('runtime')}>
        View computer
      </button>
      <p role="status">{navigation.requestedHarness() ?? 'No selection'}</p>
      <p aria-label="Requested mode">
        {navigation.requestedControl?.() ? 'control' : 'watch'}
      </p>
      <button onClick={() => navigation.request('runtime', true)}>
        Control computer
      </button>
      <button onClick={() => navigation.consume('runtime')}>Consume</button>
    </section>
  );
}

it('keeps pending navigation within its application owner and consumes it once', () => {
  render(() => (
    <>
      <SettingsScreenNavigationProvider>
        <Selection label="First app" />
      </SettingsScreenNavigationProvider>
      <SettingsScreenNavigationProvider>
        <Selection label="Second app" />
      </SettingsScreenNavigationProvider>
    </>
  ));
  const first = within(screen.getByRole('region', { name: 'First app' }));
  const second = within(screen.getByRole('region', { name: 'Second app' }));
  fireEvent.click(first.getByRole('button', { name: 'View computer' }));
  expect(first.getByRole('status').textContent).toBe('runtime');
  expect(second.getByRole('status').textContent).toBe('No selection');
  fireEvent.click(first.getByRole('button', { name: 'Consume' }));
  expect(first.getByRole('status').textContent).toBe('No selection');
});

it.each([
  { enabled: false, loading: false },
  { enabled: true, loading: true },
])(
  'discards pending navigation when the rollout becomes unavailable: %j',
  (unavailable) => {
    mocks.agentsEnabled = true;
    const [flag, setFlag] = createSignal({ enabled: true, loading: false });
    mocks.read = flag;
    render(() => (
      <SettingsScreenNavigationProvider>
        <Selection label="App" />
      </SettingsScreenNavigationProvider>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'View computer' }));
    expect(screen.getByRole('status').textContent).toBe('runtime');
    setFlag(unavailable);
    expect(screen.getByRole('status').textContent).toBe('No selection');
    fireEvent.click(screen.getByRole('button', { name: 'View computer' }));
    setFlag({ enabled: true, loading: false });
    expect(screen.getByRole('status').textContent).toBe('No selection');
  }
);

it('keeps watch and explicit control requests distinct', () => {
  render(() => (
    <SettingsScreenNavigationProvider>
      <Selection label="App" />
    </SettingsScreenNavigationProvider>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Control computer' }));
  expect(screen.getByLabelText('Requested mode').textContent).toBe('control');
  fireEvent.click(screen.getByRole('button', { name: 'View computer' }));
  expect(screen.getByLabelText('Requested mode').textContent).toBe('watch');
});
