/** @vitest-environment jsdom */
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';
import type { ViewNode } from '../types';

beforeAll(initializeNativeSurfaceTests);

function commentMark(props: object, state: string): ViewNode {
  return {
    key: 2,
    type: 'comment-mark',
    typeIndex: 0,
    kind: 'element',
    parent: null,
    children: [],
    text: '',
    propsJSON: JSON.stringify(props),
    stateJSON: state,
    props: () => JSON.parse(JSON.stringify(props)),
  };
}

test('comment marks carry the Source theme mark, comment, draft and local classes', () => {
  const fixture = nativeSurface(undefined, { mark: 'md-mark' });
  try {
    const renderer = fixture.view.registry.get('comment-mark');
    const published = commentMark({ ids: ['thread'], threadId: 1 }, '');
    const element = renderer.createDOM(published, fixture.view.context);
    expect(element.tagName).toBe('MARK');
    expect(element.className).toBe('md-mark comment local');
    expect(element.dataset.threadId).toBe('1');

    const remoteDraft = commentMark(
      { ids: ['thread'], isDraft: true },
      '{"local":false}'
    );
    expect(
      renderer.updateDOM(published, remoteDraft, element, fixture.view.context)
    ).toBe(false);
    expect(element.className).toBe('md-mark comment draft');
    expect(element.dataset.threadId).toBeUndefined();
  } finally {
    fixture.close();
  }
});
