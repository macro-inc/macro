import { Bar } from '@core/component/TopBar/Bar';
import { buildMentionMarkdownString } from '@lexical-core/utils/mentions';
import { createSignal, type JSX } from 'solid-js';
import { MarkdownTextarea } from '../core/MarkdownTextarea';
import { StaticMarkdown, StaticMarkdownContext } from '../core/StaticMarkdown';

const testMdText = `user mention:
<m-user-mention>{"userId":"macro|seamus@macro.com","email":"seamus@macro.com"}</m-user-mention>



document mention:
<m-document-mention>{"documentId":"16152a98-4cd8-4e73-80c2-b8331b4f224d","blockName":"md","documentName":"✏️ Canvas Block Overview"}</m-document-mention>



document mention with params:
<m-document-mention>{"documentId":"fe35af45-5d56-4e5d-8af1-edb5e1950b4c","blockName":"pdf","documentName":"Business letter","blockParams":{"pdf_page_number":"2","pdf_page_y":"0"}}</m-document-mention>



date mention:
<m-date-mention>{"date":"2025-10-02T00:00:00.000Z","displayFormat":"Thu, Oct 2"}</m-date-mention>



- lists with nesting
  - nested list
  - nested list 2
    - nested list 3

- Lists of all types

1. nice

- [x] checkmate

this is a paragraph that is double returned. should be like that**.**

**bold** *italic* ***bolditalic*** ~~striiiiiiiike~~ and finally \`code\`

# H1

## H2

### H3

> block quote asdlkasjdlkasjdlkasjdlaskjdalskj

\`\`\`
code block
\`\`\`

`.trim();

const textMdWithCodeBlock = `
\`\`\`javascript
const a = 1;
const b = 2;

console.log(a + b);
\`\`\`

\`\`\`css
.my-class {
  color: red;
}
\`\`\`

`.trim();

function Container(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-4 w-full max-w-xl p-4 bg-panel rounded-lg border border-edge h-64">
      <label class="text-xs text-ink-muted">{props.label}</label>
      <div class="h-px bg-edge"></div>
      <div class="h-full overflow-y-auto">{props.children}</div>
    </div>
  );
}

export default function EditorTestPage() {
  const [message, setMessage] = createSignal('');
  const [sentMessage, setSentMessage] = createSignal('');

  const sendMessage = () => {
    setSentMessage(message());
    return true;
  };

  return (
    <div class="flex flex-col h-full w-full">
      <Bar
        left={
          <div class="p-2 text-sm w-2xl truncate">Markdown Editor Test</div>
        }
        center={<div></div>}
      ></Bar>
      <div class="w-full h-full p-8 flex-1 flex flex-row flex-wrap gap-4 overflow-y-auto items-start justify-center content-start">
        <Container label="regular markdown editor">
          <MarkdownTextarea type="markdown" editable={() => true} />
        </Container>

        <Container label="readonly with custom md text">
          <MarkdownTextarea
            type="markdown"
            editable={() => false}
            initialValue={testMdText}
          />
        </Container>

        <Container label="chat editor (no headings) + custom placeholder">
          <MarkdownTextarea
            type="chat"
            editable={() => true}
            placeholder="Cool Placeholder!"
          />
        </Container>

        <Container
          label={`editor with on enter handler {message: ${sentMessage()}}`}
        >
          <MarkdownTextarea
            type="chat"
            editable={() => true}
            onChange={(val) => setMessage(val)}
            onEnter={sendMessage}
            initialValue=" - [ ] this is a todo"
          />
        </Container>

        <Container label="static markdown renderer - no context">
          <StaticMarkdown markdown={testMdText} />
        </Container>

        <Container label="multi render in context">
          <StaticMarkdownContext>
            <StaticMarkdown markdown={'message 1\n\n- nice to see you'} />
            <StaticMarkdown
              markdown={'message 2\n\n- nice to see **you** too'}
            />
            <StaticMarkdown markdown={'message 3\n\n`robo mode`'} />
          </StaticMarkdownContext>
        </Container>

        <Container label="static markdown with syntax highlighting">
          <StaticMarkdownContext>
            <StaticMarkdown markdown={textMdWithCodeBlock} />
          </StaticMarkdownContext>
        </Container>

        <Container label="read only editor with syntax highlighting">
          <MarkdownTextarea
            type="markdown"
            editable={() => false}
            initialValue={textMdWithCodeBlock}
          />
        </Container>

        <Container label="markdown area with onTab and onEscape handlers">
          <MarkdownTextarea
            type="markdown"
            editable={() => true}
            onTab={(e) => {
              console.log('TAB', e);
              return true;
            }}
            onEscape={(e) => {
              console.log('ESCAPE', e);
              return true;
            }}
          />
        </Container>
        <Container label="test buildMentionMarkdownString(info: MentionInfo)">
          <MarkdownTextarea
            type="markdown"
            editable={() => false}
            initialValue={[
              buildMentionMarkdownString({
                type: 'user',
                userId: 'macro|seamus@macro.com',
                email: 'seamus@macro.com',
              }),
              buildMentionMarkdownString({
                type: 'document',
                documentId: '85a8b7c3-5976-440e-a0b6-5f9d9448073a',
                blockName: 'canvas',
                documentName: '',
              }),
              buildMentionMarkdownString({
                type: 'contact',
                contactId: 'macro',
                name: 'macro',
                emailOrDomain: 'macro',
                isCompany: true,
              }),
              buildMentionMarkdownString({
                type: 'date',
                date: new Date().toISOString(),
                displayFormat: Date.now().toLocaleString(),
              }),
            ].join('\n\n')}
          />
        </Container>
      </div>
    </div>
  );
}
