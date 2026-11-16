import { HoverCard } from '@core/component/HoverCard';
import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityData } from '../types/entity';
import {
  GlobalBulkEditEntityModal,
  openBulkEditModal,
} from './BulkEditEntityModal';

vi.mock('@core/util/createControlledOpenSignal', async () => {
  const { createSignal } = await import('solid-js');
  return { createControlledOpenSignal: (open: boolean) => createSignal(open) };
});
vi.mock('../queries/dss', () => ({
  createBulkDeleteDssItemsMutation: () => ({ mutateAsync: vi.fn() }),
}));
// The real selection renders item chips whose hover previews open on focus.
vi.mock('./components/EntityActionSelection', () => ({
  EntityActionSelection: () => (
    <HoverCard
      openDelay={0}
      trigger={<button type="button">Quarterly plan</button>}
      content={<div>File preview</div>}
    />
  ),
}));

afterEach(() => {
  vi.useRealTimers();
});

describe('bulk-delete dialog focus', () => {
  it('opens without focusing an item chip or its preview', async () => {
    vi.useFakeTimers();
    const entity = { id: 'doc', type: 'document' } as EntityData;
    openBulkEditModal({ view: 'delete', entities: [entity] });
    render(() => <GlobalBulkEditEntityModal />);

    await vi.runAllTimersAsync();

    const chip = screen.getByRole('button', { name: 'Quarterly plan' });
    expect(document.activeElement).not.toBe(chip);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(
      true
    );
    expect(screen.queryByText('File preview')).toBeNull();
  });
});
