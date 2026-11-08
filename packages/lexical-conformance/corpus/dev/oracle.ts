// Load the actual service functions with deterministic constructor capabilities.
import { mock, setSystemTime } from 'bun:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { object } from './scan';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const alphabet =
  'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
let counter = 0;
setSystemTime(new Date('2026-11-07T12:00:00.000Z'));
mock.module(
  createRequire(root + 'packages/lexical-core/nodes/AwaitNode.ts').resolve(
    'nanoid'
  ),
  () => ({
    nanoid: (size = 21) =>
      Array.from({ length: size }, () => alphabet[counter++ % 64])
        .reverse()
        .join(''),
  })
);

// Some current import/constructor error handlers print source JSON. Never let the
// oracle emit those diagnostics; the runner records only stable result categories.
for (const method of [
  'log',
  'warn',
  'error',
  'info',
  'debug',
  'trace',
] as const)
  console[method] = () => {};
await import(root + 'services/lexical-service/src/polyfills/prism.ts');
const conversions = await import(
  root + 'services/lexical-service/src/lib/convsersions.ts'
);
const { createEditor } = await import(
  root + 'services/lexical-service/src/lib/editor.ts'
);
const xml = await import(
  root + 'packages/lexical-core/transformers/xml/index.ts'
);
const gate = await import(
  root + 'services/lexical-service/src/lib/comment-only-change.ts'
);
const mentions = await import(
  root + 'packages/lexical-core/utils/markdown-mentions.ts'
);
const reply = await import(
  root + 'packages/lexical-core/utils/explicit-reply.ts'
);
const context = await import(
  root + 'packages/lexical-core/utils/agent-context.ts'
);
const announcement = await import(
  root + 'packages/lexical-core/utils/agent-announcement.ts'
);
const chat = await import(
  root + 'packages/lexical-core/utils/agent-chat-reply.ts'
);
const connection = await import(
  root + 'packages/lexical-core/utils/agent-connection-prompt.ts'
);
const image = await import(
  root + 'packages/lexical-core/utils/image-markdown.ts'
);
const snapshots = await import(
  root + 'packages/lexical-core/markdown-loro-snapshot.ts'
);
const notion = await import(root + 'packages/lexical-core/notion-markdown.ts');
const html = await import(root + 'services/lexical-service/src/lib/html.ts');
const { parseHTML } = await import('linkedom');
const { LoroDoc } = await import('loro-crdt');

export function snapshotValue(value: unknown): unknown {
  if (!object(value) || !Array.isArray(value.snapshot))
    throw new Error('Invalid snapshot result');
  const doc = new LoroDoc();
  doc.import(Uint8Array.from(value.snapshot));
  return {
    state: doc.toJSON(),
    ...(Object.hasOwn(value, 'markdown') ? { markdown: value.markdown } : {}),
  };
}

export async function oracle(
  route: string,
  input: Record<string, unknown>
): Promise<unknown> {
  counter = 0;
  try {
    let value: unknown;
    switch (route) {
      case 'html':
        {
          // Match WP-31's source oracle host. The source helper installs the
          // document/window; node exporters also need these DOM constructors.
          const { window } = parseHTML(
            '<!doctype html><html><body></body></html>'
          );
          const previous = {
            HTMLElement: globalThis.HTMLElement,
            DocumentFragment: globalThis.DocumentFragment,
            Text: globalThis.Text,
            Node: globalThis.Node,
          };
          Object.assign(globalThis, {
            HTMLElement: window.HTMLElement,
            DocumentFragment: window.DocumentFragment,
            Text: window.Text,
            Node: window.Node,
          });
          try {
            value = html.markdownToHtml(String(input.markdown));
          } finally {
            Object.assign(globalThis, previous);
          }
        }
        break;
      case 'plaintext':
        value = conversions.toPlaintext(input.state);
        break;
      case 'search':
        value = conversions.toSearchText(input.state);
        break;
      case 'cognition':
        value = conversions.toCognitionText(input.state);
        break;
      case 'cognitionv2':
        value = conversions.toCognitionV2(input.state);
        break;
      case 'markdown/internal':
        value = conversions.toMarkdownText(input.state, 'internal');
        break;
      case 'markdown/external':
        value = conversions.toMarkdownText(input.state, 'external');
        break;
      case 'markdown/embedding':
        value = conversions.toMarkdownText(input.state, 'embedding');
        break;
      case 'comment-mark':
        value = conversions.toCommentMarkContext(input.state, input.markId);
        break;
      case 'xml':
        value = xml.toXml(input.state);
        break;
      case 'json-roundtrip': {
        const editor = createEditor();
        editor.setEditorState(editor.parseEditorState(input.state));
        value = editor.getEditorState().toJSON();
        break;
      }
      case 'mentions':
        value = mentions.extractChannelMentionsFromMarkdown(input.markdown);
        break;
      case 'extract-reply':
        value = reply.extractExplicitReply(input.markdown);
        break;
      case 'agent-context':
        value = context.composeAgentContextPrompt(input);
        break;
      case 'agent-announcement':
        value = announcement.composeAgentSessionAnnouncement(input);
        break;
      case 'agent-chat-reply':
        value = chat.composeAgentChatReply(input);
        break;
      case 'agent-connection-prompt':
        value = connection.composeAgentConnectionPrompt(input);
        break;
      case 'image-markdown':
        value = image.composeImageMarkdown(input);
        break;
      case 'snapshot/markdown': {
        const bytes = await snapshots.markdownToLoroSnapshot(input.markdown);
        if (!bytes) throw new Error('Snapshot conversion failed');
        value = { snapshot: Array.from(bytes) };
        break;
      }
      case 'snapshot/state': {
        const bytes = await snapshots.serializedEditorStateToLoroSnapshot(
          input.state
        );
        if (!bytes) throw new Error('Snapshot conversion failed');
        value = { snapshot: Array.from(bytes) };
        break;
      }
      case 'snapshot/notion': {
        const result = await notion.notionMarkdownToLoroSnapshot(
          input.markdown,
          input.links
        );
        if (!result.snapshot) throw new Error('Snapshot conversion failed');
        value = {
          snapshot: Array.from(result.snapshot),
          markdown: result.markdown,
        };
        break;
      }
      case 'comment-only-change': {
        const commentOnly = gate.isCommentOnlyChange(input.before, input.after);
        // Observing normalization must replay the same constructor entropy as
        // the production comparison, rather than consume a second sequence.
        counter = 0;
        value = {
          commentOnly,
          before: gate.contentWithoutComments(input.before),
          after: gate.contentWithoutComments(input.after),
        };
        break;
      }
      default:
        throw new Error('Unknown corpus route');
    }
    return { ok: JSON.parse(JSON.stringify(value)) };
  } catch {
    return { error: 'conversion' };
  }
}
