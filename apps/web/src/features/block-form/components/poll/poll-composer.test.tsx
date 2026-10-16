import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PollComposer } from './poll-composer';

afterEach(cleanup);

describe('PollComposer', () => {
  it('focuses each added choice and posts the question with the selected settings', async () => {
    const post = vi.fn();
    render(() => (
      <PollComposer
        pending={false}
        error={undefined}
        onPost={post}
        onCancel={() => {}}
      />
    ));
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Post poll' })
        .disabled
    ).toBe(true);
    fireEvent.input(screen.getByLabelText('Question'), {
      target: { value: 'Where should we meet?' },
    });
    fireEvent.input(screen.getByLabelText('Option 1'), {
      target: { value: 'Office' },
    });
    fireEvent.input(screen.getByLabelText('Option 2'), {
      target: { value: 'Cafe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Option 3'))
    );
    fireEvent.input(screen.getByLabelText('Option 3'), {
      target: { value: 'Online' },
    });
    fireEvent.click(screen.getByLabelText('Multiple answers'));
    fireEvent.click(screen.getByLabelText('Show results to respondents'));
    fireEvent.submit(screen.getByRole('form', { name: 'New poll' }));
    expect(post).toHaveBeenCalledWith({
      question: 'Where should we meet?',
      options: ['Office', 'Cafe', 'Online'],
      multi: true,
      showResults: false,
    });
  });

  it('keeps at least two choices and preserves their text when removing a choice', async () => {
    render(() => (
      <PollComposer
        pending={false}
        error={undefined}
        onPost={() => {}}
        onCancel={() => {}}
      />
    ));
    expect(
      screen.queryByRole('button', { name: 'Remove option 1' })
    ).toBeNull();
    fireEvent.input(screen.getByLabelText('Option 1'), {
      target: { value: 'First' },
    });
    fireEvent.input(screen.getByLabelText('Option 2'), {
      target: { value: 'Second' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    fireEvent.input(screen.getByLabelText('Option 3'), {
      target: { value: 'Third' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove option 2' }));
    expect(screen.getByLabelText<HTMLInputElement>('Option 2').value).toBe(
      'Third'
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Option 2'))
    );
    expect(
      screen.queryByRole('button', { name: 'Remove option 1' })
    ).toBeNull();
  });
});

it('blocks duplicate choice labels before posting and clears the error when corrected', () => {
  const post = vi.fn();
  render(() => (
    <PollComposer
      pending={false}
      error={undefined}
      onPost={post}
      onCancel={() => {}}
    />
  ));
  fireEvent.input(screen.getByLabelText('Question'), {
    target: { value: 'Lunch?' },
  });
  fireEvent.input(screen.getByLabelText('Option 1'), {
    target: { value: 'Pizza' },
  });
  fireEvent.input(screen.getByLabelText('Option 2'), {
    target: { value: ' pizza ' },
  });
  expect(screen.getByRole('alert').textContent).toContain(
    'Each option needs a different name.'
  );
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Post poll' })
      .disabled
  ).toBe(true);
  fireEvent.submit(screen.getByRole('form', { name: 'New poll' }));
  expect(post).not.toHaveBeenCalled();
  fireEvent.input(screen.getByLabelText('Option 2'), {
    target: { value: 'Salad' },
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Post poll' })
      .disabled
  ).toBe(false);
});
