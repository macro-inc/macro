import type { Clip } from '@core/docx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  clipboardHtml,
  htmlToParagraphs,
  readClipboardHtml,
} from './clipboard';

const read = (html: string) => readClipboardHtml(html, 'doc-1').paragraphs;

describe('clipboard', () => {
  it('round-trips its own paragraphs and tells documents apart', () => {
    const clip: Clip = {
      paragraphs: [
        {
          runs: [{ text: 'Héllo “world”', attrs: { 'r:w:b': '<w:b/>' } }],
          props: '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>',
        },
      ],
      html: '<meta charset="utf-8"><h1>Héllo</h1>',
      text: 'Héllo “world”',
    };
    const html = clipboardHtml(clip, 'doc-1');
    expect(html).toContain('<h1>Héllo</h1>');
    expect(readClipboardHtml(html, 'doc-1')).toEqual({
      paragraphs: clip.paragraphs,
      sameDocument: true,
    });
    expect(readClipboardHtml(html, 'doc-2').sameDocument).toBe(false);
  });

  it('reads Google Docs HTML', () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Bold</span><span style="font-weight:400;font-style:italic;"> and italic</span></p><ul><li dir="ltr"><p dir="ltr"><span>One</span></p></li><li><p><span>Two</span></p><ol><li><p><span>Nested</span></p></li></ol></li></ul><h2 dir="ltr"><span>Title</span></h2><br><p><span style="text-decoration:underline;">Under</span></p></b>';
    expect(read(html)).toEqual([
      {
        runs: [
          { text: 'Bold', bold: true },
          { text: ' and italic', italic: true },
        ],
      },
      { runs: [{ text: 'One' }], list: 'bullet', level: 0 },
      { runs: [{ text: 'Two' }], list: 'bullet', level: 0 },
      { runs: [{ text: 'Nested' }], list: 'number', level: 1 },
      { runs: [{ text: 'Title' }], heading: 2 },
      { runs: [] },
      { runs: [{ text: 'Under', underline: true }] },
      // The last paragraph's mark.
      { runs: [] },
    ]);
  });

  it('reads Word HTML lists without their labels', () => {
    const html = `<html><body><!--StartFragment--><p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span></span>Item one<o:p></o:p></p><p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l1 level2 lfo2'><span style='mso-list:Ignore'>(a)<span>&nbsp; </span></span>Sub <b>item</b><o:p></o:p></p><!--EndFragment--></body></html>`;
    expect(read(html)).toEqual([
      { runs: [{ text: 'Item one' }], list: 'bullet', level: 0 },
      {
        runs: [{ text: 'Sub ' }, { text: 'item', bold: true }],
        list: 'number',
        level: 1,
      },
      { runs: [] },
    ]);
  });

  it('collapses whitespace, keeps line breaks and joins table cells', () => {
    const doc = new DOMParser().parseFromString(
      '<p>  Hello\n   world  </p><p>line<br>break</p><table><tr><td>A</td><td><b>B</b></td></tr></table><pre>a  b</pre>',
      'text/html'
    );
    expect(htmlToParagraphs(doc.body)).toEqual([
      { runs: [{ text: 'Hello world' }] },
      { runs: [{ text: 'line\nbreak' }] },
      { runs: [{ text: 'A\t' }, { text: 'B', bold: true }] },
      { runs: [{ text: 'a  b' }] },
      { runs: [] },
    ]);
    // One paragraph, or text after the last block, pastes inline.
    expect(
      htmlToParagraphs(
        new DOMParser().parseFromString('<p>Only</p>', 'text/html').body
      )
    ).toEqual([{ runs: [{ text: 'Only' }] }]);
    expect(
      htmlToParagraphs(
        new DOMParser().parseFromString('<p>One</p>two', 'text/html').body
      )
    ).toEqual([{ runs: [{ text: 'One' }] }, { runs: [{ text: 'two' }] }]);
  });
});
