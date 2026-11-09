import { $createImageNode } from '@macro-inc/lexical-core/nodes/ImageNode';
import { $createVideoNode } from '@macro-inc/lexical-core/nodes/VideoNode';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addMediaFromFile,
  INSERT_MEDIA_COMMAND,
  mediaPlugin,
  ON_MEDIA_COMPONENT_MOUNT_COMMAND,
  UPDATE_MEDIA_SIZE_COMMAND,
  UPLOAD_MEDIA_SUCCESS_COMMAND,
} from '../plugins/media/mediaPlugin';
import { behaviorEditor } from './editor';

// Transport and HEIC conversion are browser/service boundaries. These cases
// supply PNG/MP4 files; they do not exercise HEIC decoding.
// The plugin, insertion helpers, nodes, selection and serialization are real.
vi.hoisted(() => {
  vi.stubGlobal(
    'WebSocket',
    class {
      readyState = 1;
      close() {}
      addEventListener() {}
      removeEventListener() {}
      send() {}
    }
  );
});
vi.mock('@core/heic/service', () => ({
  heicConversionService: { canConvert: () => false },
}));
afterEach(() => vi.useRealTimers());

for (const type of ['image', 'video'] as const) {
  const create = (srcType = 'url') =>
    type === 'image'
      ? $createImageNode({
          srcType,
          id: 'static-file',
          url: 'https://example.com/image.png',
          width: 100,
          height: 80,
        })
      : $createVideoNode({
          srcType,
          id: 'static-file',
          url: 'https://example.com/video.mp4',
          width: 100,
          height: 80,
        });

  describe(`${type} media commands`, () => {
    it.each(['url', 'sfs', 'dss'] as const)(
      'inserts %s media with constraints through the real insertion helper',
      (source) => {
        const { editor } = behaviorEditor(mediaPlugin());
        editor.update(
          () => {
            const text = $createTextNode('retained');
            $getRoot().append($createParagraphNode().append(text));
            text.select(0, 0);
            const payload =
              source === 'url'
                ? { type: source, url: 'https://example.com/media' }
                : { type: source, id: 'static-file' };
            expect(
              editor.dispatchCommand(INSERT_MEDIA_COMMAND, {
                ...payload,
                mediaType: type,
                constrainedMediaDimensions: { width: 320, height: 240 },
              })
            ).toBe(true);
          },
          { discrete: true }
        );
        editor.read(() => {
          const node = $getRoot().getFirstChild();
          expect(node?.exportJSON()).toMatchObject({
            type,
            srcType: source,
            constrainedWidth: 320,
            constrainedHeight: 240,
            ...(source === 'url'
              ? { url: 'https://example.com/media' }
              : { id: 'static-file' }),
          });
          expect($getRoot().getLastChild()?.getTextContent()).toBe('retained');
        });
      }
    );

    it.each([true, false])(
      'resizes only the matching media kind (matching=%s)',
      (matching) => {
        const { editor } = behaviorEditor(mediaPlugin());
        let key = '';
        editor.update(
          () => {
            const node = create();
            key = node.getKey();
            $getRoot().append(node);
          },
          { discrete: true }
        );
        expect(
          editor.dispatchCommand(UPDATE_MEDIA_SIZE_COMMAND, [
            key,
            { width: 640, height: 480 },
            matching ? type : type === 'image' ? 'video' : 'image',
          ])
        ).toBe(true);
        editor.read(() =>
          expect($getRoot().getFirstChild()?.exportJSON()).toMatchObject({
            type,
            width: matching ? 640 : 100,
            height: matching ? 480 : 80,
          })
        );
      }
    );

    it('ignores a late resize after the node was removed', () => {
      const { editor } = behaviorEditor(mediaPlugin());
      let key = '';
      editor.update(
        () => {
          const node = create();
          key = node.getKey();
          $getRoot().append(node);
          node.remove();
          $getRoot().append(
            $createParagraphNode().append($createTextNode('retained'))
          );
        },
        { discrete: true }
      );
      expect(
        editor.dispatchCommand(UPDATE_MEDIA_SIZE_COMMAND, [
          key,
          { width: 640, height: 480 },
          type,
        ])
      ).toBe(true);
      editor.read(() => {
        expect(
          $getRoot()
            .getChildren()
            .map((node) => node.getType())
        ).toEqual(['paragraph']);
        expect($getRoot().getTextContent()).toBe('retained');
      });
    });

    for (const keyName of ['Backspace', 'Delete']) {
      it.each([
        { name: 'character', command: DELETE_CHARACTER_COMMAND },
        { name: 'word', command: DELETE_WORD_COMMAND },
        { name: 'line', command: DELETE_LINE_COMMAND },
      ])(
        `${keyName} removes the selected media and consumes one following $name deletion`,
        ({ command }) => {
          const { editor } = behaviorEditor(mediaPlugin());
          let otherKey = '';
          editor.update(
            () => {
              const selected = create();
              const other = create();
              otherKey = other.getKey();
              $getRoot().append(
                $createParagraphNode().append($createTextNode('before')),
                selected,
                other,
                $createParagraphNode().append($createTextNode('after'))
              );
              const selection = $createNodeSelection();
              selection.add(selected.getKey());
              $setSelection(selection);
              expect(
                editor.dispatchCommand(
                  keyName === 'Backspace'
                    ? KEY_BACKSPACE_COMMAND
                    : KEY_DELETE_COMMAND,
                  new KeyboardEvent('keydown', { key: keyName })
                )
              ).toBe(true);
              expect(editor.dispatchCommand(command, true)).toBe(true);
              expect(editor.dispatchCommand(command, true)).toBe(false);
            },
            { discrete: true }
          );
          editor.read(() => {
            expect(
              $getRoot()
                .getChildren()
                .map((node) => node.getType())
            ).toEqual(['paragraph', type, 'paragraph']);
            expect($getRoot().getChildAtIndex(1)?.getKey()).toBe(otherKey);
            expect(
              $getRoot()
                .getAllTextNodes()
                .map((node) => node.getTextContent())
            ).toEqual(['before', 'after']);
          });
        }
      );
    }

    it.each(['Backspace', 'Delete'])(
      'yields %s for a text range without removing media',
      (keyName) => {
        const { editor } = behaviorEditor(mediaPlugin());
        editor.update(
          () => {
            const text = $createTextNode('retained');
            $getRoot().append($createParagraphNode().append(text), create());
            text.select(1, 3);
            expect(
              editor.dispatchCommand(
                keyName === 'Backspace'
                  ? KEY_BACKSPACE_COMMAND
                  : KEY_DELETE_COMMAND,
                new KeyboardEvent('keydown', { key: keyName })
              )
            ).toBe(false);
          },
          { discrete: true }
        );
        editor.read(() =>
          expect(
            $getRoot()
              .getChildren()
              .map((node) => node.getType())
          ).toEqual(['paragraph', type])
        );
      }
    );

    it.each(['url', 'sfs'])(
      'mount notifications reflect existing %s source without uploading',
      async (srcType) => {
        vi.useFakeTimers();
        const { editor } = behaviorEditor(mediaPlugin());
        const completed = vi.fn();
        const dispose = editor.registerCommand(
          UPLOAD_MEDIA_SUCCESS_COMMAND,
          (payload) => {
            completed(payload);
            return false;
          },
          COMMAND_PRIORITY_LOW
        );
        try {
          let key = '';
          editor.update(
            () => {
              const node = create(srcType);
              key = node.getKey();
              $getRoot().append(node);
            },
            { discrete: true }
          );
          expect(
            editor.dispatchCommand(ON_MEDIA_COMPONENT_MOUNT_COMMAND, [
              key,
              type,
            ])
          ).toBe(true);
          await vi.advanceTimersByTimeAsync(0);
          if (srcType === 'sfs')
            expect(completed).toHaveBeenCalledExactlyOnceWith([
              key,
              'static-file',
              type,
            ]);
          else expect(completed).not.toHaveBeenCalled();
        } finally {
          dispose();
        }
      }
    );
  });
}

for (const type of ['image', 'video'] as const) {
  describe(`${type} asynchronous paste editability`, () => {
    it.each([true, false])(
      'does not insert if permission is absent before processing=%s',
      async (beforeProcessing) => {
        const { editor } = behaviorEditor(mediaPlugin());
        editor.update(
          () =>
            $getRoot().append(
              $createParagraphNode().append($createTextNode('retained'))
            ),
          { discrete: true }
        );
        const before = editor.getEditorState().toJSON();
        if (beforeProcessing) editor.setEditable(false);
        const pending = addMediaFromFile(
          editor,
          new File(['media'], type === 'image' ? 'image.png' : 'video.mp4', {
            type: type === 'image' ? 'image/png' : 'video/mp4',
          }),
          type
        );
        editor.setEditable(false);
        expect(await pending).toEqual({ success: false });
        editor.read(() => expect($getRoot().getTextContent()).toBe('retained'));
        expect(editor.getEditorState().toJSON()).toEqual(before);
      }
    );
  });
}
