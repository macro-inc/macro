import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CrmMobileTabs } from './crm-mobile-tabs';

vi.mock('@components/app/mobile/PillTabs', () => ({
  PillTabs: (props: { items: { value: string; label: JSX.Element }[] }) => (
    <For each={props.items}>
      {(item) => <button role="tab">{item.label}</button>}
    </For>
  ),
}));

afterEach(cleanup);

it('removes records, activity, and lists on denial while keeping a shared pipeline', () => {
  const [allowed, setAllowed] = createSignal(true);
  render(() => (
    <CrmMobileTabs
      canAccess={allowed()}
      active="active"
      pipelines={[{ id: 'shared', name: 'Shared pipeline' }]}
      lists={[{ id: 'saved', name: 'Saved list' }]}
      onNavigate={() => {}}
    />
  ));
  expect(screen.getByRole('tab', { name: 'Companies' })).toBeTruthy();
  expect(screen.getAllByRole('tab')).toHaveLength(8);
  setAllowed(false);
  expect(screen.getAllByRole('tab')).toHaveLength(1);
  expect(screen.getByRole('tab', { name: 'Shared pipeline' })).toBeTruthy();
  setAllowed(true);
  expect(screen.getAllByRole('tab')).toHaveLength(8);
});
