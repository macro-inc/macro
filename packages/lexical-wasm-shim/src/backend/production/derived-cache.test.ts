import { expect, test } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import { ParagraphNode, type RootNode, TextNode } from '../../nodes';
import { diagnostics } from '../conformance';
import { DerivedCacheValues } from './derived-cache';

test('exact native objects keep separate cells across editors and real commits', () => {
  const first = createEditor({
    onError(error) {
      throw error;
    },
  });
  const second = createEditor({
    onError(error) {
      throw error;
    },
  });
  const values = new DerivedCacheValues();
  let firstRoot: RootNode | undefined;
  let secondRoot: RootNode | undefined;
  let firstParagraph: ParagraphNode | undefined;
  let secondParagraph: ParagraphNode | undefined;
  try {
    first.update(
      () => {
        firstRoot = $getRoot();
        firstParagraph = new ParagraphNode().append(new TextNode('first'));
        firstRoot.append(firstParagraph);
        firstParagraph.setTextFormat(3).setTextStyle('color: red');
        values.initRoot(firstRoot);
        values.initElement(firstParagraph, {
          textFormat: firstParagraph.getTextFormat(),
          textStyle: firstParagraph.getTextStyle(),
        });
      },
      { discrete: true }
    );
    second.update(
      () => {
        secondRoot = $getRoot();
        secondParagraph = new ParagraphNode().append(new TextNode('second'));
        secondRoot.append(secondParagraph);
        secondParagraph.setTextFormat(7).setTextStyle('font-weight: bold');
        values.initRoot(secondRoot);
        values.initElement(secondParagraph, {
          textFormat: secondParagraph.getTextFormat(),
          textStyle: secondParagraph.getTextStyle(),
        });
      },
      { discrete: true }
    );
    if (!firstRoot || !secondRoot || !firstParagraph || !secondParagraph)
      throw new Error('Missing real captures');
    const rootA = firstRoot,
      rootB = secondRoot,
      paragraphA = firstParagraph,
      paragraphB = secondParagraph;
    expect(rootA === rootB).toBe(false);
    expect(paragraphA === paragraphB).toBe(false);
    expect(values.readRoot(rootA)).toBeNull();
    expect(values.readRoot(rootB)).toBeNull();
    expect(values.readTextFormat(paragraphA)).toBe(3);
    expect(values.readTextStyle(paragraphA)).toBe('color: red');
    expect(values.readTextFormat(paragraphB)).toBe(7);
    expect(values.readTextStyle(paragraphB)).toBe('font-weight: bold');
    const calibration = diagnostics.crossings();
    const before = diagnostics.crossings();
    const observationCost = before - calibration;
    for (let i = 0; i < 100; i++) {
      values.readRoot(rootA);
      values.readRoot(rootB);
      values.readTextFormat(paragraphA);
      values.readTextStyle(paragraphB);
    }
    expect(diagnostics.crossings() - before - observationCost).toBe(0);
    const rebound = new DerivedCacheValues();
    expect(rebound.readTextFormat(paragraphA)).toBe(3);
    rebound.initElement(paragraphA, { textFormat: 3, textStyle: 'color: red' });
    expect(() =>
      rebound.initElement(paragraphA, { textFormat: 7, textStyle: 'changed' })
    ).toThrow('projection authority');
    expect(values.readTextFormat(paragraphA)).toBe(3);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test('missing or invalid raw metadata never initializes an element cell', () => {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  const values = new DerivedCacheValues();
  try {
    editor.update(
      () => {
        const paragraph = new ParagraphNode();
        $getRoot().append(paragraph);
        // Exercise malformed JS input at the value boundary without fabricating
        // an editor, native callback, authority capability, or model record.
        expect(() =>
          Reflect.apply(values.initElement, values, [
            paragraph,
            { textStyle: '' },
          ])
        ).toThrow('complete raw');
        expect(() => values.readTextStyle(paragraph)).toThrow(
          'not initialized'
        );
        expect(() =>
          values.initElement(paragraph, { textFormat: NaN, textStyle: '' })
        ).toThrow('complete raw');
        values.initElement(paragraph, {
          textFormat: paragraph.getTextFormat(),
          textStyle: paragraph.getTextStyle(),
        });
        expect(values.readTextStyle(paragraph)).toBe('');
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});
