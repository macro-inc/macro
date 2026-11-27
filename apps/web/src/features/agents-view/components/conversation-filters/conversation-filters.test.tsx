import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type ConversationFilters,
  EMPTY_CONVERSATION_FILTERS,
} from '../../core/conversation-filters';
import { ConversationFiltersControl } from './conversation-filters';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

afterEach(cleanup);

it('counts applied filters and hidden routine runs inside the filter button', () => {
  const [filters, setFilters] = createSignal<ConversationFilters>(
    EMPTY_CONVERSATION_FILTERS
  );
  const [showUnlistedRuns, setShowUnlistedRuns] = createSignal(false);
  render(() => (
    <ConversationFiltersControl
      filters={filters()}
      onFilterChange={vi.fn()}
      onClearFilters={vi.fn()}
      showUnlistedRuns={showUnlistedRuns()}
      onShowUnlistedRunsChange={vi.fn()}
    />
  ));
  const trigger = screen.getByRole('button', { name: 'Filter conversations' });
  expect(trigger.textContent).toBe('');

  setFilters({ ...EMPTY_CONVERSATION_FILTERS, type: ['code'] });
  setShowUnlistedRuns(true);
  expect(trigger.textContent).toBe('2');
});
