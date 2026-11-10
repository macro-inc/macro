// @vitest-environment jsdom

import { createHeadlessEditor } from '@lexical/headless';
import { $generateNodesFromDOM } from '@lexical/html';
import { $isElementNode, type LexicalNode } from 'lexical';
import { afterEach, expect, test, vi } from 'vitest';
import { AgentSessionMentionNode } from '../../../lexical-core/nodes/AgentSessionMentionNode';
import { BookingLinkMentionNode } from '../../../lexical-core/nodes/BookingLinkMentionNode';
import { ClassedBlockNode } from '../../../lexical-core/nodes/ClassedBlockNode';
import { ContactMentionNode } from '../../../lexical-core/nodes/ContactMentionNode';
import { DateMentionNode } from '../../../lexical-core/nodes/DateMentionNode';
import { DocumentCardNode } from '../../../lexical-core/nodes/DocumentCardNode';
import { DocumentMentionNode } from '../../../lexical-core/nodes/DocumentMentionNode';
import { EquationNode } from '../../../lexical-core/nodes/EquationNode';
import { GroupMentionNode } from '../../../lexical-core/nodes/GroupMentionNode';
import { HorizontalRuleNode } from '../../../lexical-core/nodes/HorizontalRuleNode';
import { HtmlRenderNode } from '../../../lexical-core/nodes/HtmlRenderNode';
import { ImageNode } from '../../../lexical-core/nodes/ImageNode';
import { PasteNode } from '../../../lexical-core/nodes/PasteNode';
import { PullRequestMentionNode } from '../../../lexical-core/nodes/PullRequestMentionNode';
import { SnapshotNode } from '../../../lexical-core/nodes/SnapshotNode';
import { TagMentionNode } from '../../../lexical-core/nodes/TagMentionNode';
import { ThemeMentionNode } from '../../../lexical-core/nodes/ThemeMentionNode';
import { UnknownMentionNode } from '../../../lexical-core/nodes/UnknownMentionNode';
import { UserMentionNode } from '../../../lexical-core/nodes/UserMentionNode';
import { VideoNode } from '../../../lexical-core/nodes/VideoNode';
import { WatermarkNode } from '../../../lexical-core/nodes/WatermarkNode';
import { importHTML } from './html-import';
import { NodeViewRegistry } from './registry';

afterEach(() => vi.restoreAllMocks());
const classes = [
  PasteNode,
  UserMentionNode,
  ContactMentionNode,
  DateMentionNode,
  GroupMentionNode,
  WatermarkNode,
  UnknownMentionNode,
  AgentSessionMentionNode,
  BookingLinkMentionNode,
  TagMentionNode,
  PullRequestMentionNode,
  DocumentMentionNode,
  DocumentCardNode,
  SnapshotNode,
  ThemeMentionNode,
  HtmlRenderNode,
  ClassedBlockNode,
  EquationNode,
  HorizontalRuleNode,
  ImageNode,
  VideoNode,
];
const registry = new NodeViewRegistry();
for (const node of classes)
  registry.register(node.getType(), {
    createDOM() {
      throw new Error('DOM renderer not used by HTML importer');
    },
    updateDOM() {
      return false;
    },
  });
function exported(node: LexicalNode): object {
  const value = node.exportJSON();
  if ($isElementNode(node))
    return { ...value, children: node.getChildren().map(exported) };
  return value;
}
const cases = [
  '<div data-document-card data-document-id="document" data-block-name="md" data-block-params="null" data-preview-box="null"></div>',
  '<span data-document-mention data-document-id="document" data-block-name="md" data-block-params="null"></span>',
  '<span data-theme-mention data-theme-json="null">invalid</span>',
  '<span data-theme-mention data-theme-json="[]">invalid</span>',

  '<div data-paste-node data-content="large text" data-paste-origin="referenced"></div>',
  '<div data-paste-node data-content="large text" data-paste-origin="invalid"></div>',
  '<span data-user-mention data-user-id="fixture-user" data-email="user@example.com">label</span>',
  '<span data-user-mention data-user-id="fixture-user" data-email="user@example.com" data-display-name="Alias" data-mention-uuid="ignored">label</span>',
  '<span data-user-mention>invalid</span>',
  '<span data-contact-mention data-contact-id="contact" data-name="Contact" data-email-or-domain="example.com" data-is-company="true">label</span>',
  '<span data-date-mention data-date="2026-01-01" data-display-format="January">date</span>',
  '<span data-group-mention data-group-alias="group">group</span>',
  '<span data-watermark data-content="content">label</span>',
  '<div data-unknown-mention></div>',
  '<div data-agent-session-mention data-agent-session-id="agent" data-agent-session-expanded="true" data-agent-session-label="Agent" data-mention-uuid="mention"></div>',
  '<span data-agent-session-mention data-agent-session-id="agent"></span>',
  '<a data-booking-link-mention data-booking-profile-id="profile" data-booking-url="https://example.com/booking" data-booking-slug="slot" data-booking-label="Book"></a>',
  '<span data-tag-mention data-tag-option-id="option" data-tag-property-definition-id="property" data-tag-scope="team" data-tag-name="Tag" data-tag-color="blue"></span>',
  '<span data-tag-mention data-tag-option-id="option" data-tag-property-definition-id="property" data-tag-scope="invalid">invalid</span>',
  '<a data-pr-mention data-pr-url="https://github.com/example/project/pull/12" data-pr-label="PR"></a>',
  '<span data-pr-mention data-pr-id="pull" data-mention-uuid="mention"></span>',
  '<span data-pr-mention data-pr-url="https://example.com/pull/1">invalid</span>',
  '<span data-document-mention data-document-id="document" data-block-name="md" data-document-name="Document" data-collapsed="true" data-channel-type="channel" data-created-at="42" data-block-params=\'{"parameter":"value"}\'></span>',
  '<div data-document-card data-document-id="document" data-block-name="canvas" data-preview-box=\'[100,200]\' data-preview-data=\'{"kind":"preview"}\'></div>',
  '<div data-document-card data-document-id="document" data-block-name="md"></div>',
  '<span data-snapshot-node data-document-id="document" data-snapshot-date="2026-01-01T00:00:00.000Z" data-content="content"></span>',
  '<span data-theme-mention data-theme-json=\'{"name":"Theme","value":42}\'></span>',
  '<span data-theme-mention data-theme-json="invalid">invalid</span>',
  '<div class="macro_html_render macro_html_render_adapt"><template shadowrootmode="open"><b>hello</b></template></div>',
  '<div data-html-render data-html=\'"<em>hello</em>"\'></div>',
  '<div data-classed-block class="one two"><b>bold</b></div>',
  '<div data-lexical-equation="eF4y" data-lexical-inline="true"></div>',
  '<span data-lexical-equation="eF4y"></span>',
  '<hr>',
  '<img src="https://example.com/image" data-src-type="url" data-image-id="image" alt="Alt" width="100" height="50" data-scale="0.5" data-constrained-width="80">',
  '<div><img src="https://example.com/image" data-src-type="url" data-image-id="image" data-scale="0"></div>',
  '<div><img src="https://example.com/image" data-src-type="url" data-image-id="image"><span>keep</span></div>',
  '<video src="https://example.com/video" data-src-type="url" data-video-id="video" width="100" height="50" controls></video>',
];
for (const html of [
  ...cases,
  ...cases.map((html) => '<section>before' + html + 'after</section>'),
])
  test('Macro import matches source: ' + html, () => {
    vi.spyOn(Date, 'now').mockReturnValue(1767225600000);
    let actual: object[] = [];
    const editor = createHeadlessEditor({
      namespace: 'macro-html-oracle',
      nodes: classes,
      onError(error) {
        throw error;
      },
    });
    editor.update(
      () => {
        actual = $generateNodesFromDOM(
          editor,
          new DOMParser().parseFromString(html, 'text/html')
        ).map(exported);
      },
      { discrete: true }
    );
    expect(
      importHTML(html, document, registry).map((json) => JSON.parse(json))
    ).toEqual(JSON.parse(JSON.stringify(actual)));
  });

test('HTML render validates serialized attributes before choosing template content', () => {
  const html =
    '<div data-html-render data-html="invalid"><template shadowrootmode="open"><b>template</b></template></div>';
  const editor = createHeadlessEditor({
    namespace: 'macro-html-error-oracle',
    nodes: [HtmlRenderNode],
    onError(error) {
      throw error;
    },
  });
  expect(() =>
    editor.update(
      () => {
        $generateNodesFromDOM(
          editor,
          new DOMParser().parseFromString(html, 'text/html')
        );
      },
      { discrete: true }
    )
  ).toThrow(SyntaxError);
  expect(() => importHTML(html, document, registry)).toThrow(SyntaxError);
});
