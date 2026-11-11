import {
  ForeignBasePatch,
  ForeignNativeField,
  ForeignNativeProjection,
} from '@macro-inc/collaboration/session/compatibility.generated';
import { expect, test, vi } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import { LineBreakNode, ParagraphNode, TabNode, TextNode } from '../../nodes';
import { captureNodePayload } from './node-payload';

test('text and tab payloads retain complete raw fields, UTF16 and source mode3', () => {
  const editor = createEditor({
    namespace: 'raw payload text',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const text = new TextNode('source')
          .setFormat(5)
          .setStyle('color: red')
          .toggleUnmergeable();
        const raw = 'A\ud83d\udca9\ud800';
        const textDescriptor = Object.getOwnPropertyDescriptor(text, '__text');
        const modeDescriptor = Object.getOwnPropertyDescriptor(text, '__mode');
        if (!textDescriptor || !modeDescriptor)
          throw new Error('missing actual text fields');
        let reads = 0;
        Object.defineProperty(text, '__text', {
          configurable: true,
          get: () => {
            reads++;
            return raw;
          },
        });
        Object.defineProperty(text, '__mode', {
          configurable: true,
          get: () => 3,
        });
        const latest = vi.spyOn(text, 'getLatest').mockImplementation(() => {
          throw new Error('getLatest is not raw');
        });
        try {
          const payload = captureNodePayload(text, {
            kind: 'text',
            nativeType: 'text',
          });
          expect(payload.base.text).toEqual({
            text: [65, 0xd83d, 0xdca9, 0xd800],
            format: 5,
            detail: 2,
            mode: 3,
            style: 'color: red',
          });
          expect(reads).toBe(1);
          expect(latest).not.toHaveBeenCalled();
          expect(
            ForeignBasePatch.decode(ForeignBasePatch.encode(payload.base)).text
          ).toEqual(payload.base.text);
          expect(payload.nativeProjection).toMatchObject({
            nativeType: 'text',
            complete: true,
            fields: [],
          });
        } finally {
          latest.mockRestore();
          Object.defineProperty(text, '__text', textDescriptor);
          Object.defineProperty(text, '__mode', modeDescriptor);
        }
        const tab = captureNodePayload(new TabNode(), {
          kind: 'tab',
          nativeType: 'tab',
        });
        expect(tab.base.text?.text).toEqual([9]);
        expect(tab.nativeProjection.nativeType).toBe('tab');
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('Element and Root payloads contain every scalar and never read Root cache or infer type names', () => {
  const editor = createEditor({
    namespace: 'raw payload element',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const paragraph = new ParagraphNode()
          .setFormat('right')
          .setIndent(2)
          .setDirection('rtl')
          .setStyle('element style')
          .setTextFormat(3)
          .setTextStyle('text style');
        $getRoot().append(paragraph);
        const getType = vi
          .spyOn(paragraph, 'getType')
          .mockImplementation(() => {
            throw new Error('type inference is forbidden');
          });
        try {
          const generic = captureNodePayload(paragraph, {
            kind: 'generic-element',
            nativeType: '',
          });
          expect(generic.base.element).toEqual({
            format: 3,
            indent: 2,
            direction: 2,
            textFormat: 3,
            textStyle: 'text style',
            style: 'element style',
          });
          expect(generic.nativeProjection).toMatchObject({
            nativeType: '',
            complete: true,
            fields: [],
          });
          expect(getType).not.toHaveBeenCalled();
        } finally {
          getType.mockRestore();
        }
        const root = $getRoot();
        const cacheDescriptor = Object.getOwnPropertyDescriptor(
          root,
          '__cachedText'
        );
        if (!cacheDescriptor)
          throw new Error('missing actual Root cache accessor');
        Object.defineProperty(root, '__cachedText', {
          configurable: true,
          get: () => {
            throw new Error('Root cache must not be serialized');
          },
        });
        try {
          const payload = captureNodePayload(root, {
            kind: 'root',
            nativeType: 'root',
          });
          expect(Object.keys(payload.base.element ?? {})).toEqual([
            'format',
            'indent',
            'direction',
            'textFormat',
            'textStyle',
            'style',
          ]);
          expect(payload.nativeProjection.fields).toEqual([]);
        } finally {
          Object.defineProperty(root, '__cachedText', cacheDescriptor);
        }
        const linebreak = captureNodePayload(new LineBreakNode(), {
          kind: 'linebreak',
          nativeType: 'linebreak',
        });
        expect(linebreak.base.text).toBeUndefined();
        expect(linebreak.base.element).toBeUndefined();
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('heading projection uses the generated field ID and strict primitive h1 through h6 tags', () => {
  const editor = createEditor({
    namespace: 'raw payload heading',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const element = new ParagraphNode();
        let reads = 0;
        Object.defineProperty(element, '__tag', {
          configurable: true,
          get: () => {
            reads++;
            return 'h6';
          },
        });
        const payload = captureNodePayload(element, {
          kind: 'heading',
          nativeType: 'heading',
        });
        expect(reads).toBe(1);
        expect(payload.nativeProjection.fields[0].field).toBe(
          ForeignNativeField.HeadingNodeTag
        );
        expect(payload.nativeProjection.fields[0].value.data).toMatchObject({
          discriminator: 10,
          value: { value: [104, 54] },
        });
        expect(
          ForeignNativeProjection.decode(
            ForeignNativeProjection.encode(payload.nativeProjection)
          ).fields[0].field
        ).toBe(ForeignNativeField.HeadingNodeTag);
        for (const tag of [
          'h0',
          'h7',
          'H1',
          ' h1 ',
          1,
          null,
          {
            toString: () => {
              throw new Error('no tag coercion');
            },
          },
        ]) {
          Object.defineProperty(element, '__tag', {
            configurable: true,
            value: tag,
          });
          expect(() =>
            captureNodePayload(element, {
              kind: 'heading',
              nativeType: 'heading',
            })
          ).toThrow('raw h1 through h6');
        }
        const failure = { opaque: true };
        Object.defineProperty(element, '__tag', {
          get: () => {
            throw failure;
          },
        });
        try {
          captureNodePayload(element, {
            kind: 'heading',
            nativeType: 'heading',
          });
          throw new Error('expected getter failure');
        } catch (error) {
          expect(error).toBe(failure);
        }
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('payload projection rejects mismatched categories, incomplete scalars and unsupported descriptors', () => {
  const editor = createEditor({
    namespace: 'raw payload validation',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const text = new TextNode('text');
        const element = new ParagraphNode();
        expect(() =>
          captureNodePayload(element, { kind: 'root', nativeType: 'root' })
        ).toThrow('actual RootNode');
        expect(() =>
          captureNodePayload(element, { kind: 'text', nativeType: 'text' })
        ).toThrow('actual TextNode');
        expect(() =>
          captureNodePayload(text, {
            kind: 'paragraph',
            nativeType: 'paragraph',
          })
        ).toThrow('actual ElementNode');
        expect(() =>
          Reflect.apply(captureNodePayload, undefined, [
            element,
            { kind: 'generic-element', nativeType: 'paragraph' },
          ])
        ).toThrow('must be empty');
        expect(() =>
          Reflect.apply(captureNodePayload, undefined, [
            element,
            { kind: 'unknown', nativeType: '' },
          ])
        ).toThrow('Unsupported');
        let descriptorReads = 0;
        const changingDescriptor = {
          kind: 'generic-element',
          get nativeType() {
            descriptorReads++;
            return descriptorReads === 1 ? 'paragraph' : '';
          },
        };
        expect(() =>
          Reflect.apply(captureNodePayload, undefined, [
            element,
            changingDescriptor,
          ])
        ).toThrow('must be empty');
        expect(descriptorReads).toBe(1);
        const styleDescriptor = Object.getOwnPropertyDescriptor(
          text,
          '__style'
        );
        if (!styleDescriptor) throw new Error('missing actual style accessor');
        Object.defineProperty(text, '__style', {
          configurable: true,
          get: () => undefined,
        });
        try {
          expect(() =>
            captureNodePayload(text, { kind: 'text', nativeType: 'text' })
          ).toThrow('every raw base field');
        } finally {
          Object.defineProperty(text, '__style', styleDescriptor);
        }
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});
