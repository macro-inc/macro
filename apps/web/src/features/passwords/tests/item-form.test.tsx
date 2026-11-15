import { t } from '@app/lib/i18n';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { ItemForm } from '../components/item-form';
import type { PasswordDraft } from '../core/types';

afterEach(cleanup);

function mountForm(initial: PasswordDraft) {
  const [draft, setDraft] = createSignal(initial);
  render(() => (
    <ItemForm
      idPrefix="test"
      draft={draft()}
      totpKey=""
      hasTotp={false}
      folders={[]}
      isNew
      onChange={setDraft}
      onTotpKey={() => {}}
    />
  ));
  return draft;
}

it('types non-secret template fields in the clear and masks secret and added fields', () => {
  mountForm({
    name: 'Card',
    kind: 'card',
    url: '',
    folderId: null,
    favorite: false,
    private: false,
    values: {
      username: '',
      password: '',
      notes: '',
      fields: [
        { label: t('passwords.field_expires'), value: '' },
        { label: t('passwords.field_securityCode'), value: '' },
      ],
    },
  });
  const expires = screen.getByLabelText('Expires', { selector: 'input' });
  fireEvent.input(expires, { target: { value: '12/30' } });
  expect(expires?.getAttribute('type')).toBe('text');
  expect(
    screen
      .getByLabelText('Security code', { selector: 'input' })
      ?.getAttribute('type')
  ).toBe('password');
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  const added = screen.getAllByLabelText('Field value', { selector: 'input' });
  expect(added.at(-1)?.getAttribute('type')).toBe('password');
});

it('masks a template field once it is renamed, and Identity contact fields type in the clear', () => {
  const draft = mountForm({
    name: 'Person',
    kind: 'identity',
    url: '',
    folderId: null,
    favorite: false,
    private: false,
    values: {
      username: '',
      password: '',
      notes: '',
      fields: [
        { label: t('passwords.field_email'), value: '' },
        { label: t('passwords.field_phone'), value: '' },
        { label: t('passwords.field_address'), value: '' },
      ],
    },
  });
  for (const label of ['Email', 'Phone', 'Address'])
    expect(
      screen.getByLabelText(label, { selector: 'input' })?.getAttribute('type')
    ).toBe('text');
  const [emailLabel] = screen.getAllByLabelText('Field label');
  fireEvent.input(emailLabel, { target: { value: 'Recovery code' } });
  expect(draft().values.fields[0].label).toBe('Recovery code');
  expect(
    screen
      .getByLabelText('Recovery code', { selector: 'input' })
      ?.getAttribute('type')
  ).toBe('password');
});

function typeInto(input: HTMLElement, text: string) {
  input.focus();
  for (let end = 1; end <= text.length; end++)
    fireEvent.input(input, { target: { value: text.slice(0, end) } });
}

function card(): PasswordDraft {
  return {
    name: 'Card',
    kind: 'card',
    url: '',
    folderId: null,
    favorite: false,
    private: false,
    values: {
      username: '',
      password: '',
      notes: '',
      fields: [
        { label: t('passwords.field_expires'), value: '' },
        { label: t('passwords.field_securityCode'), value: '' },
      ],
    },
  };
}

it('keeps a custom field focused while its value is typed one character at a time', () => {
  const draft = mountForm(card());
  for (const [label, text] of [
    ['Expires', '12/2028'],
    ['Security code', '4321'],
  ] as const) {
    const input = screen.getByLabelText(label, { selector: 'input' });
    input.focus();
    for (let end = 1; end <= text.length; end++) {
      fireEvent.input(input, { target: { value: text.slice(0, end) } });
      expect(screen.getByLabelText(label, { selector: 'input' })).toBe(input);
      expect(document.activeElement).toBe(input);
    }
  }
  expect(draft().values.fields).toEqual([
    { label: 'Expires', value: '12/2028' },
    { label: 'Security code', value: '4321' },
  ]);
});

it('keeps Identity contact fields focused while typing', () => {
  const draft = mountForm({
    ...card(),
    name: 'Person',
    kind: 'identity',
    values: {
      username: '',
      password: '',
      notes: '',
      fields: [
        { label: t('passwords.field_email'), value: '' },
        { label: t('passwords.field_phone'), value: '' },
        { label: t('passwords.field_address'), value: '' },
      ],
    },
  });
  for (const [label, text] of [
    ['Email', 'ops@example.test'],
    ['Phone', '+1 555 0100'],
    ['Address', 'Example location'],
  ] as const) {
    const input = screen.getByLabelText(label, { selector: 'input' });
    typeInto(input, text);
    expect(screen.getByLabelText(label, { selector: 'input' })).toBe(input);
    expect(document.activeElement).toBe(input);
  }
  expect(draft().values.fields.map((field) => field.value)).toEqual([
    'ops@example.test',
    '+1 555 0100',
    'Example location',
  ]);
});

it('keeps template slots focused while typing', () => {
  mountForm({
    ...card(),
    name: '',
    kind: 'login',
    values: { username: '', password: '', notes: '', fields: [] },
  });
  for (const [label, text] of [
    ['Name', 'Deploy login'],
    ['Username', 'deploy-bot'],
    ['Password', 'not-a-real-secret'],
  ] as const) {
    const input = screen.getByLabelText(label, { selector: 'input' });
    typeInto(input, text);
    expect(screen.getByLabelText(label, { selector: 'input' })).toBe(input);
    expect(document.activeElement).toBe(input);
  }
});

it('adds, renames and removes custom fields by position without losing focus', () => {
  const draft = mountForm(card());
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  const added = screen.getAllByLabelText('Field label').at(-1);
  if (!added) throw new Error('no added field');
  typeInto(added, 'Recovery email');
  expect(screen.getAllByLabelText('Field label').at(-1)).toBe(added);
  expect(document.activeElement).toBe(added);
  const addedValue = screen.getByLabelText('Recovery email', {
    selector: 'input',
  });
  typeInto(addedValue, 'backup@example.test');
  expect(document.activeElement).toBe(addedValue);

  const [expiresLabel] = screen.getAllByLabelText('Field label');
  const expiresValue = screen.getByLabelText('Expires', { selector: 'input' });
  typeInto(expiresLabel, 'Valid thru');
  expect(document.activeElement).toBe(expiresLabel);
  expect(expiresValue.isConnected).toBe(true);
  expect(expiresValue.getAttribute('aria-label')).toBe('Valid thru');
  expect(expiresValue.getAttribute('type')).toBe('password');

  fireEvent.click(screen.getAllByRole('button', { name: 'Remove field' })[0]);
  expect(draft().values.fields).toEqual([
    { label: 'Security code', value: '' },
    { label: 'Recovery email', value: 'backup@example.test' },
  ]);
  expect(
    screen
      .getAllByLabelText('Field label')
      .map((input) => (input as HTMLInputElement).value)
  ).toEqual(['Security code', 'Recovery email']);
  expect(
    (
      screen.getByLabelText('Recovery email', {
        selector: 'input',
      }) as HTMLInputElement
    ).value
  ).toBe('backup@example.test');
  expect(
    screen.queryByLabelText('Valid thru', { selector: 'input' })
  ).toBeNull();
});
