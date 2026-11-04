import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileSearchFilterDrawer } from './mobile-search-filter-drawer';

vi.mock('./search-filters-state', () => ({
  createSearchFiltersController: () => ({}),
}));
vi.mock('./search-facets', () => ({
  useSearchFacets: () => {
    const [discovering, setDiscovering] = createSignal(false);
    const facet = {
      id: 'task-assignee',
      kind: 'multi',
      label: 'Assignee',
      placeholder: 'Search assignees...',
      options: () => [
        { id: 'member', label: 'Member' },
        ...(discovering() ? [{ id: 'outside', label: 'Outside' }] : []),
      ],
      activeIds: () => [],
      onChange: vi.fn(),
      isDefault: () => true,
      reset: vi.fn(),
      values: () => [],
      action: () => ({
        label: discovering() ? 'Back to team members' : 'Find other people…',
        onSelect: () => setDiscovering((value) => !value),
      }),
      onPickerClose: () => setDiscovering(false),
    };
    return () => [facet];
  },
}));
vi.mock('@app/components/view-shell/MobileFilterDrawer', () => ({
  MobileFilterDrawer: Object.assign(
    (props: ParentProps<{ onOpenChange: (open: boolean) => void }>) => (
      <>
        <button onClick={() => props.onOpenChange(false)}>Close drawer</button>
        <button onClick={() => props.onOpenChange(true)}>Open drawer</button>
        {props.children}
      </>
    ),
    { Option: (props: ParentProps) => <button>{props.children}</button> }
  ),
}));
vi.mock('@components/app/mobile/MobileDrawer', () => ({
  MobileDrawer: {
    Section: (props: ParentProps) => <div>{props.children}</div>,
    Item: (props: ParentProps) => <div>{props.children}</div>,
  },
}));
vi.mock('@kobalte/core/accordion', () => {
  const Part = (props: ParentProps) => <div>{props.children}</div>;
  const Content = (props: ParentProps) => {
    const [expanded, setExpanded] = createSignal(true);
    return (
      <>
        <button onClick={() => setExpanded(false)}>Collapse section</button>
        <button onClick={() => setExpanded(true)}>Expand section</button>
        <Show when={expanded()}>{props.children}</Show>
      </>
    );
  };
  return {
    Accordion: Object.assign(Part, {
      Item: Part,
      Header: Part,
      Trigger: Part,
      Content,
    }),
  };
});

afterEach(cleanup);

it.each(['drawer', 'section'])(
  'clears an outsider search after reopening the %s',
  (target) => {
    render(() => <MobileSearchFilterDrawer />);
    const search = screen.getByRole('textbox');
    fireEvent.input(search, { target: { value: 'outside' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find other people…' }));
    expect(screen.getByText('Outside')).toBeTruthy();
    expect(screen.queryByText('Member')).toBeNull();
    if (target === 'drawer') {
      fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
      fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Collapse section' }));
      fireEvent.click(screen.getByRole('button', { name: 'Expand section' }));
    }
    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.queryByText('Outside')).toBeNull();
    expect(screen.getByDisplayValue('')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Find other people…' })
    ).toBeTruthy();
  }
);
