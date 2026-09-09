import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { inputOutlineFocusClasses } from './Input';
import { TextField } from './TextField';

afterEach(cleanup);

describe('TextField', () => {
  it('connects its label and description to the input', () => {
    render(() => (
      <TextField>
        <TextField.Label>Email</TextField.Label>
        <TextField.Input />
        <TextField.Description>Used for notifications.</TextField.Description>
      </TextField>
    ));

    const input = screen.getByRole('textbox', { name: 'Email' });
    const description = screen.getByText('Used for notifications.');

    expect(input.getAttribute('aria-describedby')).toContain(description.id);
    expect(input.hasAttribute('data-input')).toBe(true);
    expect(input.dataset.slot).toBe('text-field-input');
  });

  it('composes Input sizing and variants', () => {
    render(() => (
      <TextField>
        <TextField.Label>Search</TextField.Label>
        <TextField.Input size="sm" variant="bare" />
      </TextField>
    ));

    const input = screen.getByRole('textbox', { name: 'Search' });
    expect(input.dataset.size).toBe('sm');
    expect(input.dataset.variant).toBe('bare');
    expect(input.classList).toContain('h-6');
  });

  it('shares the outlined Input focus treatment with TextArea', () => {
    const { container } = render(() => (
      <>
        <TextField>
          <TextField.Input aria-label="Title" />
        </TextField>
        <TextField>
          <TextField.TextArea aria-label="Description" />
        </TextField>
      </>
    ));

    const input = screen.getByRole('textbox', { name: 'Title' });
    const textarea = screen.getByRole('textbox', { name: 'Description' });
    for (const className of inputOutlineFocusClasses.split(' ')) {
      expect(input.classList).toContain(className);
      expect(textarea.classList).toContain(className);
    }
    expect(textarea.classList).toContain('bg-input');
    expect(textarea.classList).toContain('resize-none');
    expect(textarea.classList).not.toContain('resize-y');
    expect(container.querySelectorAll('[data-input]')).toHaveLength(1);
  });

  it('marks an invalid input and connects its error message', () => {
    render(() => (
      <TextField validationState="invalid">
        <TextField.Label>Email</TextField.Label>
        <TextField.Input />
        <TextField.ErrorMessage>Enter a valid email.</TextField.ErrorMessage>
      </TextField>
    ));

    const input = screen.getByRole('textbox', { name: 'Email' });
    const error = screen.getByText('Enter a valid email.');

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('deduplicates structured error messages', () => {
    render(() => (
      <TextField validationState="invalid">
        <TextField.Input aria-label="Password" />
        <TextField.ErrorMessage
          errors={[
            { message: 'Use at least 12 characters.' },
            { message: 'Add a symbol.' },
            { message: 'Use at least 12 characters.' },
          ]}
        />
      </TextField>
    ));

    expect(screen.getAllByText('Use at least 12 characters.')).toHaveLength(1);
    expect(screen.getByText('Add a symbol.')).toBeTruthy();
  });
});
