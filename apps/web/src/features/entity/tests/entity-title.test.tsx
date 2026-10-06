import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityTitle } from '../extractors/entity-title';
import type { FormEntity } from '../types/entity';

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => (
      <span>{props.markdown}</span>
    ),
  })
);
vi.mock('../extractors/reminder-title', () => ({ ReminderTitle: () => null }));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: (name: string) => `Untitled ${name}`,
}));
vi.mock('@core/component/LexicalMarkdown/theme', () => ({
  unifiedListMarkdownTheme: {},
}));

afterEach(cleanup);

describe('form entity titles', () => {
  it('shows the form name in entity lists', () => {
    const form: FormEntity = {
      type: 'form',
      id: '01a10d51-874a-7b22-9204-41f537bb2572',
      name: 'Workshop booking request',
      ownerId: 'macro|forms-owner@local.macro.test',
      access: 'owner',
    };
    const { getByText, queryByText } = render(() => (
      <EntityTitle entity={form} />
    ));
    expect(getByText('Workshop booking request')).toBeTruthy();
    expect(queryByText('Unknown')).toBeNull();
  });

  it('updates when a linked database rename refreshes the form', () => {
    const [form, setForm] = createSignal<FormEntity>({
      type: 'form',
      id: '01a10d51-874a-7b22-9204-41f537bb2572',
      name: 'Workshop booking request',
      ownerId: 'macro|forms-owner@local.macro.test',
      access: 'owner',
    });
    const { getByText, queryByText } = render(() => (
      <EntityTitle entity={form()} />
    ));
    setForm((current) => ({ ...current, name: 'Team workshop' }));
    expect(getByText('Team workshop')).toBeTruthy();
    expect(queryByText('Workshop booking request')).toBeNull();
  });

  it('uses the form default for an empty name', () => {
    const form: FormEntity = {
      type: 'form',
      id: '01a10d51-874a-7b22-9204-41f537bb2572',
      name: '',
      ownerId: 'macro|forms-owner@local.macro.test',
      access: 'view',
    };
    const { getByText } = render(() => <EntityTitle entity={form} />);
    expect(getByText('Untitled form')).toBeTruthy();
  });
});
