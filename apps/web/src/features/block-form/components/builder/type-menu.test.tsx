import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { TypeMenu } from './type-menu';

afterEach(cleanup);

it('opens the database-row submenu and chooses its table', async () => {
  const choose = vi.fn();
  render(() => (
    <TypeMenu
      current="short"
      label="Short answer"
      tables={[
        { databaseId: 'database-1', tableId: 'table-1', name: 'Guests' },
      ]}
      onChoose={choose}
    />
  ));
  const trigger = screen.getByRole('button', {
    name: 'Question type: Short answer',
  });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const relation = await screen.findByRole('menuitem', {
    name: 'Database row',
  });
  relation.focus();
  fireEvent.keyDown(relation, { key: 'ArrowRight' });
  const table = await screen.findByRole('menuitem', { name: 'Guests' });
  expect(screen.getByRole('group', { name: 'Rows of' })).toBeTruthy();
  table.focus();
  fireEvent.keyDown(table, { key: 'Enter' });
  expect(choose).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'relation' }),
    { databaseId: 'database-1', tableId: 'table-1', name: 'Guests' }
  );
});
