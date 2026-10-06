import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { SignatureForm } from './signature-form';

afterEach(cleanup);

const baseProps = {
  email: 'alex@gmail.com',
  value: '',
  onInput: () => {},
  onReady: () => {},
  onSave: () => {},
  onClear: () => {},
  dirty: false,
  hasContent: false,
  pending: false,
  replies: false,
  onRepliesChange: () => {},
};

it('offers Gmail import on desktop and locks the form while importing', () => {
  const onImport = vi.fn();
  const { unmount } = render(() => (
    <SignatureForm {...baseProps} mobile={false} onImport={onImport} />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Import from Gmail' }));
  expect(onImport).toHaveBeenCalledOnce();
  unmount();

  render(() => (
    <SignatureForm
      {...baseProps}
      mobile={false}
      hasContent
      dirty
      onImport={onImport}
      importing
    />
  ));
  for (const name of ['Importing…', 'Clear signature', 'Save signature'])
    expect(
      (screen.getByRole('button', { name }) as HTMLButtonElement).disabled
    ).toBe(true);
});

it('hides Gmail import on mobile or without a handler', () => {
  const { unmount } = render(() => (
    <SignatureForm {...baseProps} mobile onImport={() => {}} />
  ));
  expect(
    screen.queryByRole('button', { name: 'Import from Gmail' })
  ).toBeNull();
  unmount();
  render(() => <SignatureForm {...baseProps} mobile={false} />);
  expect(
    screen.queryByRole('button', { name: 'Import from Gmail' })
  ).toBeNull();
});
