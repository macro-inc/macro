import { buildEditorFromExtensions } from '@lexical/extension';
import { describe, expect, test, vi } from 'vitest';
import { pluginExtension } from './pluginExtension';

describe('pluginExtension', () => {
  test('lets the Lexical extension lifecycle own registration and cleanup', () => {
    const register = vi.fn(() => vi.fn());
    const extension = pluginExtension('test/lifecycle', register);

    const editor = buildEditorFromExtensions(extension);

    expect(extension.name).toBe('@macro-inc/lexical/test/lifecycle');
    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(editor);

    const cleanup = register.mock.results[0].value;
    editor.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
