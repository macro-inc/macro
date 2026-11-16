import { fireEvent, render } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import type { HomeViewState } from '../types';
import { HomeListLayout } from './HomeListLayout';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('./HomeFilters', () => ({ HomeFilterDropdown: () => null }));

const home = vi.hoisted(() => ({ view: undefined as unknown }));
vi.mock('../home-view-context', () => ({ useHomeView: () => home.view }));

afterEach(() => {
  home.view = undefined;
});

function mount(search: string) {
  const [state, setState] = createStore<HomeViewState>({
    tab: 'signal',
    search,
    groupBy: 'date',
    facets: {},
  });
  home.view = { state, setState, focusList: () => false };

  const view = render(() => (
    <HomeListLayout tabs={null} onNewChat={() => {}}>
      <div />
    </HomeListLayout>
  ));
  return {
    view,
    state,
    button: () => view.getByRole('button', { name: 'Search Home' }),
    field: () => view.queryByRole('searchbox', { name: 'Search Home' }),
  };
}

it('shows the field whenever a query filters the list', () => {
  // As when the sidebar remounts with Home's search still set.
  const { field, button } = mount('deals');

  expect(field()).toHaveProperty('value', 'deals');
  expect(button().getAttribute('aria-expanded')).toBe('true');
});

it('keeps the field open while a remounted query is edited down to nothing', () => {
  const { field } = mount('deals');
  const input = field();
  if (!input) throw new Error('The field should be open');

  fireEvent.input(input, { target: { value: '' } });

  expect(field()).not.toBeNull();
});

it('clears the query when the Search icon closes the field', () => {
  const { state, field, button } = mount('deals');

  fireEvent.click(button());

  expect(state.search).toBe('');
  expect(field()).toBeNull();
});

it('opens an empty field from the Search icon and closes it again', () => {
  const { field, button } = mount('');
  expect(field()).toBeNull();

  fireEvent.click(button());
  expect(field()).not.toBeNull();

  fireEvent.click(button());
  expect(field()).toBeNull();
});
