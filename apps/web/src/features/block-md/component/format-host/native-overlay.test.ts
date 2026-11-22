/** @vitest-environment jsdom */
import { expect, test } from 'vitest';
import { desktopBodyFormatPopup } from '../../views/body-format-popup';
import { createNativeBodyFormattingOverlay } from './native-overlay';
import { mount, select, state } from './native-test-fixture';

test('optional body formatting releases its own listeners without closing the real document', async () => {
  const formatting = createNativeBodyFormattingOverlay({
    composition: () => desktopBodyFormatPopup,
    canEdit: () => true,
    alive: () => true,
  });
  const runtime = mount([formatting.observer]);
  try {
    runtime.port.setState(state('Body formatting'));
    select(runtime, 'Body formatting');
    expect(runtime.view.isMounted).toBe(true);
    formatting.dispose();
    formatting.dispose();
    runtime.port.setState(state('Document remains live'));
    expect(runtime.view.query.serializedState()).toContain(
      'Document remains live'
    );
    expect(runtime.view.isMounted).toBe(true);
  } finally {
    formatting.dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('missing actual ordered command ports retire optional formatting while the document stays live', async () => {
  const formatting = createNativeBodyFormattingOverlay({
    composition: () => desktopBodyFormatPopup,
    canEdit: () => true,
    alive: () => true,
  });
  const runtime = mount([formatting.observer], false);
  try {
    runtime.port.setState(state('No ordered menu ports'));
    expect(runtime.view.query.serializedState()).toContain(
      'No ordered menu ports'
    );
    expect(runtime.view.isMounted).toBe(true);
    runtime.port.setState(state('Still editable'));
    expect(runtime.view.query.serializedState()).toContain('Still editable');
  } finally {
    formatting.dispose();
    await runtime.close();
    runtime.root.remove();
  }
});
