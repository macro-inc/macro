/** @vitest-environment jsdom */
import { beforeAll, expect, test } from 'vitest';
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { storedComparison } from './dev-stored-comparison';
import { NativeEnterDispatcher } from './native-enter';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('stored probe cannot reenter an actual native callback or retire its snapshot listeners', () => {
  const fixture = nativeSurface();
  const dispatcher = NativeEnterDispatcher.forModule(native);
  const owner = dispatcher.owner(fixture.session);
  const order: string[] = [];
  let rejected: unknown;
  const first = dispatcher.register(
    fixture.session,
    owner,
    () => {
      order.push('first');
      try {
        storedComparison(fixture.view);
      } catch (error) {
        rejected = error;
      }
      return false;
    },
    1
  );
  const second = dispatcher.register(
    fixture.session,
    owner,
    () => {
      order.push('second');
      return true;
    },
    1
  );
  try {
    fixture.session.viewCommandEnter(1, 1);
    expect(order).toEqual(['first', 'second']);
    expect(rejected).toBeInstanceOf(Error);
    expect(String(rejected)).toBe(
      'Error: Ordinary native admission during scoped callback or cleanup'
    );
    fixture.session.takeOutput();
  } finally {
    first();
    second();
    fixture.close();
  }
});
