import { describe, expect, it } from 'vitest';
import { hideIncompleteMacroXml } from './hideIncompleteMacroXml';

describe('hideIncompleteMacroXml', () => {
  const complete =
    '<m-document-mention>{"documentId":"abc","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>';

  it('leaves complete mention tags intact', () => {
    expect(hideIncompleteMacroXml(`See ${complete}.`)).toBe(`See ${complete}.`);
  });

  it('strips a trailing unclosed mention tag', () => {
    expect(
      hideIncompleteMacroXml(`See ${complete.slice(0, complete.indexOf('{'))}`)
    ).toBe('See ');
  });

  it('strips a trailing bare open prefix', () => {
    expect(hideIncompleteMacroXml('See <m-document-ment')).toBe('See ');
  });

  it('leaves text with no mention markup alone', () => {
    expect(hideIncompleteMacroXml('plain reply')).toBe('plain reply');
  });
});
