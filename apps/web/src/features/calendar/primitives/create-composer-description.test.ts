import { describe, expect, it, vi } from 'vitest';
import { createComposerDescription } from './create-composer-description';

describe('composer description', () => {
  it('keeps the provider value when the editor only normalizes its representation', () => {
    const onChange = vi.fn();
    const description = createComposerDescription('Agenda', onChange);
    description.initialized('<p>Agenda</p>');
    description.changed('<p>Agenda</p>');
    expect(onChange).toHaveBeenLastCalledWith('Agenda');
  });

  it('keeps edited HTML and restores the original representation after undo', () => {
    const onChange = vi.fn();
    const original = '<p><strong>Agenda</strong><br>Notes</p>';
    const description = createComposerDescription(original, onChange);
    description.initialized('<p><b>Agenda</b><br>Notes</p>');
    description.changed('<p><b>Agenda</b><br>New notes</p>');
    expect(onChange).toHaveBeenLastCalledWith(
      '<p><b>Agenda</b><br>New notes</p>'
    );
    description.changed('<p><b>Agenda</b><br>Notes</p>');
    expect(onChange).toHaveBeenLastCalledWith(original);
  });
});
