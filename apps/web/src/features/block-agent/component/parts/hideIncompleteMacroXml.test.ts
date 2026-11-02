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

  it('keeps completed chips and surrounding prose before an unfinished chip', () => {
    expect(
      hideIncompleteMacroXml(
        `Before ${complete} after. Next <m-document-mention>{"documentId":"partial`
      )
    ).toBe(`Before ${complete} after. Next `);
  });

  it.each([
    '<m-document-ment',
    '<m-document-mention>',
    '<m-document-mention>{"documentId":"partial',
    '<m-document-mention>{"documentId":"abc"}</m-document-',
    '<m-user-mention>{"userId":"partial',
    '<m-agent-session-mention>{"id":"partial',
  ])('hides a response cut off at %s', (partial) => {
    expect(hideIncompleteMacroXml(`See ${partial}`)).toBe('See ');
  });

  it('strips a trailing bare open prefix', () => {
    expect(hideIncompleteMacroXml('See <m-document-ment')).toBe('See ');
  });

  it.each([
    'Use `<m-document-mention>` as the tag name.',
    'Use ``<m-document-mention>`` as the tag name.',
    'Example:\n```xml\n<m-document-mention>{"documentId":"example"}\n```\nAfter.',
    'Example:\n```xml\n<m-document-mention>{"documentId":"unfinished',
    'Example:\n````xml\n```\n<m-document-mention>\n````\nAfter.',
  ])('preserves literal Macro XML in code: %s', (text) => {
    expect(hideIncompleteMacroXml(text)).toBe(text);
  });

  it('still hides an unfinished chip after a closed code example', () => {
    const before = 'Use `<m-document-mention>` as the tag name. See ';
    expect(
      hideIncompleteMacroXml(`${before}<m-document-mention>{"documentId":`)
    ).toBe(before);
    const fenced = '```xml\n<m-document-mention>\n```\nSee ';
    expect(hideIncompleteMacroXml(`${fenced}<m-user-mention>{"userId":`)).toBe(
      fenced
    );
  });

  it('does not treat an escaped backtick or an unclosed inline span as code', () => {
    expect(hideIncompleteMacroXml('Use \\`<m-document-mention>')).toBe(
      'Use \\`'
    );
    expect(hideIncompleteMacroXml('Use `<m-document-mention>')).toBe('Use `');
  });

  it('leaves text with no mention markup alone', () => {
    expect(hideIncompleteMacroXml('plain reply')).toBe('plain reply');
  });
});
