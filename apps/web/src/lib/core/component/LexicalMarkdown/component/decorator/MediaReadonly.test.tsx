/** @vitest-environment jsdom */

import {
  $createImageNode,
  $createVideoNode,
  $isImageNode,
  $isVideoNode,
} from '@macro-inc/lexical-core';
import { fireEvent, render } from '@solidjs/testing-library';
import { $getNodeByKey, $getRoot } from 'lexical';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  getMediaUrl: vi.fn(),
  $upgradeDSSMediaUrl: vi.fn(),
  ON_MEDIA_COMPONENT_MOUNT_COMMAND: 'ON_MEDIA_COMPONENT_MOUNT_COMMAND',
  UPDATE_MEDIA_SIZE_COMMAND: 'UPDATE_MEDIA_SIZE_COMMAND',
  UPLOAD_MEDIA_FAILURE_COMMAND: 'UPLOAD_MEDIA_FAILURE_COMMAND',
  UPLOAD_MEDIA_START_COMMAND: 'UPLOAD_MEDIA_START_COMMAND',
  UPLOAD_MEDIA_SUCCESS_COMMAND: 'UPLOAD_MEDIA_SUCCESS_COMMAND',
}));
vi.mock('../../plugins/media', () => plugin);
vi.mock('../../plugins', () => plugin);
vi.mock('@core/component/Lightbox', () => ({ Lightbox: () => null }));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));

import { createEmailEditor } from '@app/features/email-compose/tests/editor';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { createPluginManager } from '../../plugins/pluginManager';
import { MarkdownImage } from './MarkdownImage';
import { MarkdownVideo } from './MarkdownVideo';

it.each(['image', 'video'] as const)(
  'stops active and debounced %s resizing on lock while preserving committed size',
  async (kind) => {
    vi.useFakeTimers();
    const [editable, setEditable] = createSignal(true);
    const editor = createEmailEditor();
    let key = '';
    const url = 'https://files.macro.com/audit';
    editor.update(
      () => {
        const node = (kind === 'image' ? $createImageNode : $createVideoNode)({
          srcType: 'url',
          url,
          width: 200,
          height: 100,
          scale: 1,
        });
        $getRoot().append(node);
        key = node.getKey();
      },
      { discrete: true }
    );
    const value = {
      type: 'markdown' as const,
      owner: null,
      editor,
      isInteractable: editable,
      plugins: createPluginManager(editor, 'markdown'),
      cleanup: () => {},
    };
    const view = render(() => (
      <LexicalWrapperContext.Provider value={value}>
        {kind === 'image' ? (
          <MarkdownImage
            srcType="url"
            id="image"
            key={key}
            url={url}
            alt="audit"
            width={200}
            height={100}
            scale={1}
          />
        ) : (
          <MarkdownVideo
            controls={true}
            srcType="url"
            id="video"
            key={key}
            url={url}
            width={200}
            height={100}
            scale={1}
          />
        )}
      </LexicalWrapperContext.Provider>
    ));
    try {
      const media = view.container.querySelector(
        kind === 'image' ? 'img' : 'video'
      )!;
      Object.defineProperties(
        media,
        kind === 'image'
          ? { naturalWidth: { value: 200 }, naturalHeight: { value: 100 } }
          : { videoWidth: { value: 200 }, videoHeight: { value: 100 } }
      );
      fireEvent(media, new Event(kind === 'image' ? 'load' : 'loadeddata'));
      const handles = [
        ...view.container.querySelectorAll<HTMLDivElement>(
          '.cursor-col-resize'
        ),
      ];
      expect(handles).toHaveLength(2);
      const handle = handles[1];
      handle.setPointerCapture = () => {};
      handle.releasePointerCapture = () => {};
      const frame = handle.parentElement!;
      frame.getBoundingClientRect = () => ({ ...new DOMRect(), height: 100 });
      handle.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 50 })
      );
      handle.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 100 })
      );
      await vi.advanceTimersByTimeAsync(100);
      const scale = () =>
        editor.read(() => {
          const node = $getNodeByKey(key);
          return node && ($isImageNode(node) || $isVideoNode(node))
            ? node.getScale()
            : undefined;
        });
      expect(scale()).toBe(1.5);
      // The next movement has not reached the node when the editor locks.
      handle.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 150 })
      );
      editor.setEditable(false);
      setEditable(false);
      expect(
        view.container.querySelectorAll('.cursor-col-resize')
      ).toHaveLength(0);
      handle.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 200 })
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(scale()).toBe(1.5);
      expect(
        kind === 'image' ? frame.style.maxWidth : frame.style.maxHeight
      ).toBe(kind === 'image' ? '300px' : '150px');
      editor.setEditable(true);
      setEditable(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(scale()).toBe(1.5);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  }
);
