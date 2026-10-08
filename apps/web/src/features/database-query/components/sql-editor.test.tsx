import { render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { SqlEditor } from './sql-editor';

describe('query SQL editor', () => {
  it('does not report externally accepted SQL as a user edit', async () => {
    const [value, setValue] = createSignal('SELECT 1');
    const onChange = vi.fn();
    const result = render(() => (
      <SqlEditor
        value={value()}
        schema={{ databaseId: 'db', name: 'Database', tables: [] }}
        onChange={onChange}
        onRun={() => {}}
      />
    ));
    await waitFor(() =>
      expect(result.getByRole('textbox').textContent).toBe('SELECT 1')
    );
    setValue('SELECT COUNT(*) FROM projects');
    await waitFor(() =>
      expect(result.getByRole('textbox').textContent).toBe(
        'SELECT COUNT(*) FROM projects'
      )
    );
    expect(onChange).not.toHaveBeenCalled();
    result.unmount();
  });
});
