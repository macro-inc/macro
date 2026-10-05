import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { AudiencePanel } from './audience-panel';

afterEach(cleanup);

it('keeps two panels on screen at once as separate choices', () => {
  render(() => (
    <>
      <AudiencePanel
        audience="members"
        canChange
        respondLink="https://macro.com/app/form/form-1/respond"
        onCopyFailure={() => {}}
        pending={false}
        onChange={() => {}}
      />
      <AudiencePanel
        audience="public"
        canChange
        respondLink="https://macro.com/app/form/form-1/respond"
        onCopyFailure={() => {}}
        pending={false}
        onChange={() => {}}
      />
    </>
  ));
  const members = screen.getAllByRole<HTMLInputElement>('radio', {
    name: /Invited people/,
  });
  expect(members[0].name).not.toBe(members[1].name);
  expect(members[0].checked).toBe(true);
  expect(
    screen.getAllByRole<HTMLInputElement>('radio', {
      name: /Anyone with the link/,
    })[1].checked
  ).toBe(true);
});

it('stays on the saved audience when a change is refused, claiming nothing it did not save', () => {
  const asked: string[] = [];
  render(() => (
    <AudiencePanel
      audience="members"
      canChange
      respondLink="https://macro.com/app/form/form-1/respond"
      onCopyFailure={() => {}}
      pending={false}
      onChange={(audience) => asked.push(audience)}
    />
  ));
  const anyone = screen.getByRole<HTMLInputElement>('radio', {
    name: /Anyone with the link/,
  });
  fireEvent.click(anyone);
  expect(asked).toEqual(['public']);
  // Refused (or not saved yet): the saved audience is still what shows.
  expect(anyone.checked).toBe(false);
  expect(
    screen.getByRole<HTMLInputElement>('radio', { name: /Invited people/ })
      .checked
  ).toBe(true);
});
