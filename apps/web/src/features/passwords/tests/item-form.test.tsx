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
