import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { EventEditorInitialValues } from '../components/composer/event-form-model';
import { createComposerSuggestions } from './create-composer-suggestions';

describe('composer suggestions', () => {
  it('applies a suggestion to an untouched session and settles its loading state', async () => {
    const suggestion =
      Promise.withResolvers<Partial<EventEditorInitialValues>>();
    const apply = vi.fn();
    const { source, dispose } = createRoot((dispose) => ({
      source: createComposerSuggestions({
        suggestion: suggestion.promise,
        isDirty: () => false,
        apply,
      }),
      dispose,
    }));
    expect(source.pending()).toBe(true);
    suggestion.resolve({ location: 'Room 4' });
    await source.completion;
    expect(apply).toHaveBeenCalledExactlyOnceWith({ location: 'Room 4' });
    expect(source.pending()).toBe(false);
    dispose();
  });

  it('does not overwrite changes made after the suggestion started', async () => {
    const suggestion =
      Promise.withResolvers<Partial<EventEditorInitialValues>>();
    let dirty = false;
    const apply = vi.fn();
    const { source, dispose } = createRoot((dispose) => ({
      source: createComposerSuggestions({
        suggestion: suggestion.promise,
        isDirty: () => dirty,
        apply,
      }),
      dispose,
    }));
    dirty = true;
    suggestion.resolve({ title: 'Suggested title' });
    await source.completion;
    expect(apply).not.toHaveBeenCalled();
    expect(source.pending()).toBe(false);
    dispose();
  });

  it('does not apply a late result to a disposed composer', async () => {
    const suggestion =
      Promise.withResolvers<Partial<EventEditorInitialValues>>();
    const apply = vi.fn();
    const { source, dispose } = createRoot((dispose) => ({
      source: createComposerSuggestions({
        suggestion: suggestion.promise,
        isDirty: () => false,
        apply,
      }),
      dispose,
    }));
    dispose();
    suggestion.resolve({ title: 'Suggested title' });
    await source.completion;
    expect(apply).not.toHaveBeenCalled();
  });

  it('settles a failed suggestion without clearing the current draft', async () => {
    const suggestion =
      Promise.withResolvers<Partial<EventEditorInitialValues>>();
    const apply = vi.fn();
    const { source, dispose } = createRoot((dispose) => ({
      source: createComposerSuggestions({
        suggestion: suggestion.promise,
        isDirty: () => false,
        apply,
      }),
      dispose,
    }));
    const rejected = expect(source.completion).rejects.toThrow(
      'Suggestion failed'
    );
    suggestion.reject(new Error('Suggestion failed'));
    await rejected;
    expect(source.pending()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    dispose();
  });
});
