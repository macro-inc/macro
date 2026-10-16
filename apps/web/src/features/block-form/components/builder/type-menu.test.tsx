import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { Dropdown } from '@ui';
import { afterEach, expect, it, vi } from 'vitest';
import { AddQuestionMenu, TypeMenu } from './type-menu';

afterEach(cleanup);

it('includes form flow actions in the compact add menu and closes after choosing one', async () => {
  const addSection = vi.fn();
  render(() => (
    <AddQuestionMenu
      trigger="Add question"
      tables={[]}
      hiddenColumns={[]}
      onChoose={vi.fn()}
      onAddColumn={vi.fn()}
    >
      <Dropdown.Group>
        <Dropdown.GroupLabel>Form flow</Dropdown.GroupLabel>
        <Dropdown.Item onSelect={addSection}>Section</Dropdown.Item>
      </Dropdown.Group>
    </AddQuestionMenu>
  ));
  const trigger = screen.getByRole('button', { name: 'Add question' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const section = await screen.findByRole('menuitem', { name: 'Section' });
  section.focus();
  fireEvent.keyDown(section, { key: 'Enter' });
  expect(addSection).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  );
});

it('reuses all available database columns from the compact menu', async () => {
  const addAll = vi.fn();
  render(() => (
    <AddQuestionMenu
      trigger="Add question"
      tables={[]}
      hiddenColumns={[
        { id: 'name', name: 'Name', type: 'short' },
        { id: 'notes', name: 'Notes', type: 'paragraph' },
      ]}
      onChoose={vi.fn()}
      onAddColumn={vi.fn()}
      onAddAllColumns={addAll}
    />
  ));
  const trigger = screen.getByRole('button', { name: 'Add question' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const action = await screen.findByRole('menuitem', {
    name: 'Add all 2 columns',
  });
  action.focus();
  fireEvent.keyDown(action, { key: 'Enter' });
  expect(addAll).toHaveBeenCalledOnce();
});

it('groups new questions by purpose and keeps existing database fields separate', async () => {
  const choose = vi.fn();
  const addColumn = vi.fn();
  render(() => (
    <AddQuestionMenu
      trigger="Add question"
      tables={[]}
      hiddenColumns={[
        { id: 'notes', name: 'Workshop notes', type: 'paragraph' },
      ]}
      onChoose={choose}
      onAddColumn={addColumn}
    />
  ));
  const trigger = screen.getByRole('button', { name: 'Add question' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const choices = await screen.findByRole('group', { name: 'Choices' });
  expect(
    within(choices)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
  ).toEqual(['Multiple choice', 'Checkboxes', 'Dropdown', 'Checkbox']);
  expect(
    within(screen.getByRole('group', { name: 'Text & files' })).getByRole(
      'menuitem',
      { name: 'Paragraph' }
    )
  ).toBeTruthy();
  expect(
    within(screen.getByRole('group', { name: 'Numbers & dates' })).getByRole(
      'menuitem',
      { name: 'Date' }
    )
  ).toBeTruthy();
  expect(
    within(screen.getByRole('group', { name: 'Linked items' }))
      .getByRole('menuitem', { name: 'Database row' })
      .getAttribute('aria-disabled')
  ).toBe('true');
  const existing = within(
    screen.getByRole('group', { name: 'From database' })
  ).getByRole('menuitem', { name: 'Workshop notes' });
  existing.focus();
  fireEvent.keyDown(existing, { key: 'Enter' });
  expect(addColumn).toHaveBeenCalledWith('notes');
  expect(choose).not.toHaveBeenCalled();
});

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
