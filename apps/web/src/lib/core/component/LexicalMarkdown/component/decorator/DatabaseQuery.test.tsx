import { render, waitFor } from '@solidjs/testing-library';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseQuery } from './DatabaseQuery';

const control = vi.hoisted(() => ({
  enabled: (): boolean => false,
  mounts: 0,
  cleanups: 0,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableDatabases: { key: 'enable-databases' },
}));
vi.mock('../../context/LexicalWrapperContext', async () => ({
  LexicalWrapperContext: (await import('solid-js')).createContext(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: control.enabled() }),
}));
vi.mock('./LazyDecorator', () => ({
  LazyDecorator: (props: { render: () => JSX.Element }) => props.render(),
}));
vi.mock('@app/features/database-query/database-query', () => ({
  DatabaseLiveQuestion: () => {
    control.mounts++;
    onCleanup(() => control.cleanups++);
    return <span>Interactive answer</span>;
  },
}));

describe('database answer rollout', () => {
  it('keeps the saved title without mounting live query wiring when disabled', async () => {
    const [enabled, setEnabled] = createSignal(false);
    control.enabled = enabled;
    control.mounts = 0;
    control.cleanups = 0;
    const rendered = render(() => (
      <DatabaseQuery
        key="query"
        theme={{}}
        sql="SELECT 1"
        prompt="How many?"
        title="Open tickets"
        displayMode="scalar"
      />
    ));
    expect(rendered.getByText('Open tickets')).toBeTruthy();
    expect(control.mounts).toBe(0);
    setEnabled(true);
    await waitFor(() =>
      expect(rendered.getByText('Interactive answer')).toBeTruthy()
    );
    expect(control.mounts).toBe(1);
    setEnabled(false);
    expect(rendered.getByText('Open tickets')).toBeTruthy();
    expect(control.cleanups).toBe(1);
    rendered.unmount();
  });
});
