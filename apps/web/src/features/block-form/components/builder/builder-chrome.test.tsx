import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { TitleCard } from './builder-chrome';

afterEach(cleanup);

/** A save the test answers by hand. */
function pendingSave() {
  const sent: string[] = [];
  let answer: (saved: boolean) => void = () => {};
  let last: Promise<boolean> = Promise.resolve(true);
  const save = (value: string) => {
    sent.push(value);
    last = new Promise<boolean>((resolve) => {
      answer = resolve;
    });
    return last;
  };
  /** Answer the last save; resolves once the card has seen the answer. */
  const settle = async (saved: boolean) => {
    answer(saved);
    await last;
  };
  return { sent, save, settle };
}

function mount() {
  const [name, setName] = createSignal('Untitled form');
  const [description, setDescription] = createSignal('');
  const names = pendingSave();
  const descriptions = pendingSave();
  render(() => (
    <TitleCard
      name={name()}
      description={description()}
      meta={null}
      databaseLink={null}
      onName={names.save}
      onDescription={descriptions.save}
    />
  ));
  return {
    names,
    descriptions,
    setName,
    setDescription,
    nameField: screen.getByLabelText<HTMLInputElement>('Form name'),
    descriptionField:
      screen.getByLabelText<HTMLTextAreaElement>('Form description'),
  };
}

describe('TitleCard', () => {
  it('keeps the description being typed when the form is read again underneath', async () => {
    const [name, setName] = createSignal('Untitled form');
    const [description, setDescription] = createSignal('');
    const sentNames: string[] = [];
    let finishRename!: (saved: boolean) => void;
    const rename = new Promise<boolean>((resolve) => {
      finishRename = resolve;
    });
    render(() => (
      <TitleCard
        name={name()}
        description={description()}
        meta={null}
        databaseLink={null}
        onName={(value) => {
          sentNames.push(value);
          return rename;
        }}
        onDescription={async () => true}
      />
    ));
    const nameField = screen.getByLabelText<HTMLInputElement>('Form name');
    const descriptionField =
      screen.getByLabelText<HTMLTextAreaElement>('Form description');
    nameField.focus();
    fireEvent.input(nameField, { target: { value: '  Workshop ideas ' } });
    descriptionField.focus();
    expect(sentNames).toEqual(['Workshop ideas']);
    fireEvent.input(descriptionField, {
      target: { value: 'Tell us what you would enjoy learning together' },
    });
    // The rename lands and the form is read again; its description changes
    // underneath (another tab, an earlier save) while this one is typed.
    finishRename(true);
    await rename;
    setName('Workshop ideas');
    setDescription('Earlier words');
    expect(descriptionField.value).toBe(
      'Tell us what you would enjoy learning together'
    );
    expect(nameField.value).toBe('Workshop ideas');
  });

  it('saves exactly what was typed on blur, and shows it through the save and the refresh', async () => {
    const card = mount();
    card.descriptionField.focus();
    fireEvent.input(card.descriptionField, {
      target: { value: 'Line one\nline two ' },
    });
    card.descriptionField.blur();
    expect(card.descriptions.sent).toEqual(['Line one\nline two ']);
    // A read that started before the save landed answers with an older value.
    card.setDescription('Earlier words');
    expect(card.descriptionField.value).toBe('Line one\nline two ');
    await card.descriptions.settle(true);
    card.setDescription('Line one\nline two ');
    expect(card.descriptionField.value).toBe('Line one\nline two ');
  });

  it('saves a cleared description', () => {
    const card = mount();
    card.setDescription('Old words');
    card.descriptionField.focus();
    fireEvent.input(card.descriptionField, { target: { value: '' } });
    card.descriptionField.blur();
    expect(card.descriptions.sent).toEqual(['']);
  });

  it('keeps a refused description in the field, marked unsaved, until it is saved or put back', async () => {
    const card = mount();
    card.descriptionField.focus();
    fireEvent.input(card.descriptionField, { target: { value: 'Draft' } });
    card.descriptionField.blur();
    await card.descriptions.settle(false);
    expect(card.descriptionField.value).toBe('Draft');
    expect(card.descriptionField.getAttribute('aria-invalid')).toBe('true');
    card.descriptionField.focus();
    fireEvent.keyDown(card.descriptionField, { key: 'Escape' });
    expect(card.descriptionField.value).toBe('');
    expect(card.descriptionField.getAttribute('aria-invalid')).toBe('false');
  });

  it('keeps a rejected save as a visible, invalid draft without an unhandled rejection', async () => {
    const failure = Promise.reject(new Error('Connection lost'));
    // Observe the test-owned promise too; the field must handle its rejection.
    const settled = failure.catch(() => undefined);
    render(() => (
      <TitleCard
        name="Workshop ideas"
        description="Saved words"
        meta={null}
        databaseLink={null}
        onName={async () => true}
        onDescription={() => failure}
      />
    ));
    const description =
      screen.getByLabelText<HTMLTextAreaElement>('Form description');
    description.focus();
    fireEvent.input(description, { target: { value: 'My unsaved words' } });
    description.blur();
    await settled;
    expect(description.value).toBe('My unsaved words');
    expect(description.getAttribute('aria-invalid')).toBe('true');
  });

  it('never saves an empty name: the saved one comes back', () => {
    const card = mount();
    card.nameField.focus();
    fireEvent.input(card.nameField, { target: { value: '   ' } });
    card.nameField.blur();
    expect(card.names.sent).toEqual([]);
    expect(card.nameField.value).toBe('Untitled form');
  });
});
