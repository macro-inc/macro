import {
  type BlockName,
  createBlockEffect,
  createBlockSignal,
} from '@core/block';
import { blockHandleSignal } from '@core/signal/load';
import { isErr } from '@core/util/maybeResult';
import {
  cognitionApiServiceClient,
  cognitionWebsocketServiceClient,
} from '@service-cognition/client';
import { createCognitionWebsocketBlockEffect } from '@service-cognition/websocket';
import { createMethodRegistration } from 'core/orchestrator';
import { uuid } from 'short-uuid';

export const isGeneratingMindMapSignal = createBlockSignal<boolean>(false);
export const mindmapContentSignal = createBlockSignal<string>('');
export const currentlyMappingSignal = createBlockSignal<string>('');
export const completionIdSignal = createBlockSignal<string>('');

function formatNodeName(nodeName: string) {
  let formatted = nodeName.replace(/_/g, ' ');
  formatted = formatted.replace(/([a-z])([A-Z])/g, '$1 $2');
  return formatted;
}

function parseLastMermaidLine(streamContent: string) {
  const lines = streamContent.trim().split('\n');

  let lastLine = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmedLine = lines[i].trim();
    if (trimmedLine.includes('-->')) {
      lastLine = trimmedLine;
      break;
    }
  }

  if (!lastLine) {
    return 'Generating Mind Map';
  }

  let parts = lastLine.split('-->');
  const source = parts[0]
    .trim()
    .replace(/\[.*\]$/, '')
    .trim();
  return `Mapping: ${formatNodeName(source)}`;
}

createCognitionWebsocketBlockEffect('completion_stream_chunk', (data) => {
  if (
    !isGeneratingMindMapSignal() ||
    data.completion_id !== completionIdSignal()
  ) {
    return;
  }
  const setIsGeneratingSignal = isGeneratingMindMapSignal.set;
  const setMindMapContent = mindmapContentSignal.set;

  if (data.done) {
    setIsGeneratingSignal(false);
  }
  setMindMapContent(data.content);
  currentlyMappingSignal.set(parseLastMermaidLine(data.content));
});

const generateMindMapCallback = async (
  documentType: BlockName,
  documentId: string
) => {
  const completionId = uuid();
  const setCompletionId = completionIdSignal.set;

  if (['pdf', 'md'].includes(documentType)) {
    setCompletionId(completionId);
    cognitionWebsocketServiceClient.streamSimpleCompletion({
      prompt: MINDMAP_PROMPT,
      user_request: USER_REQUEST_PROMPT,
      model: 'anthropic/claude-sonnet-4',
      content_document_ids: [documentId],
      completion_id: completionId,
    });
  } else if (['chat'].includes(documentType)) {
    const setIsGeneratingSignal = isGeneratingMindMapSignal.set;

    const chatResult = await cognitionApiServiceClient.getChat({
      chat_id: documentId,
    });
    if (isErr(chatResult)) {
      setIsGeneratingSignal(false);
      return;
    }

    const messages = chatResult[1].chat.messages;
    if (!messages || messages.length <= 1) {
      setIsGeneratingSignal(false);
      return;
    }

    let chatTranscript = '';
    const divider = '---';
    for (const message of messages) {
      const isUser = message.role === 'user';
      const sender = isUser ? 'User' : 'AI Assistant';
      chatTranscript += `\n\ \n${divider}\n${sender}\n\ \n`;
      //@ts-ignore
      //TODO: tools
      chatTranscript += `${message.content.replace(/\[\[.*?\]\]/g, '')}\n`;
    }
    const chatContent = `Your document is a chat conversation attached next. ${chatTranscript}`;
    setCompletionId(completionId);
    cognitionWebsocketServiceClient.streamSimpleCompletion({
      prompt: MINDMAP_PROMPT,
      user_request: USER_REQUEST_PROMPT + chatContent,
      model: 'anthropic/claude-sonnet-4',
      completion_id: completionId,
    });
  }
};
createBlockEffect(() =>
  createMethodRegistration(blockHandleSignal.get, {
    generateMindMap: generateMindMapCallback,
  })
);

export const canTryMindMapAgainSignal = createBlockSignal<boolean>(true);
export const redoGenerateMindMap = () => {
  const [canTryMindMapAgain, setCanTryMindMapAgain] = canTryMindMapAgainSignal;
  if (!canTryMindMapAgain()) {
    return;
  }
  setCanTryMindMapAgain(false);
};

const MINDMAP_PROMPT = `You are a helpful assistant that will help users understand documents and content through mindmaps.
You will create a single concise and accurate Mermaid flowchart that functions as a mindmap of the key concepts in the provided document/information.

Extract only the most essential concepts, ideas, and relationships from the content.
Organize these elements hierarchically with the main topic/concept as the central node.
Branch out to related subtopics, using meaningful connections that show relationships clearly.
Use brief, descriptive labels for each node - aim for 1-5 words per middle nodes, up to 10 words for leaf nodes.
Focus on clarity and information hierarchy rather than exhaustive detail.
Limit the depth to 3-4 levels to maintain readability.
Group related concepts visually in the diagram structure.
ALWAYS USE descriptive node names. DO NOT use undescriptive node names like A, B, C.
ALWAYS USE quotation marks to wrap label text, e.g. NodeName --> NodeName2["Enhanced: M ∝ e^(asdfN)"].

The output should be valid Mermaid flowchart syntax only, starting with "flowchart LR" (for left-right) and "flowchart TD" (for top-down), followed by the node and connection definitions.
Preference "flowchart LR" over "flowchart TD". ONLY use "flowchart TD" IF there are not that many nodes (< 8).
Please provide only the Mermaid flowchart code WITHOUT additional explanations, alternative diagrams, or commentary.
DO NOT PUT CODE BLOCKS, your output will be directly pasted into a mermaid renderer. So DO NOT output anything that should not be passed onto the renderer.
DO NOT include markdown syntax. <br> should NOT be in this mermaid code.

ALWAYS USE descriptive node names. DO NOT use undescriptive node names like A, B, C.
`;

const USER_REQUEST_PROMPT = `Can you create a concise Mermaid flowchart that works as a mindmap for this document I'm attaching?
I need it to show the main concepts and how they connect, with the central idea in the middle and related topics branching out.
Please keep it readable with short labels and focus on the most important relationships.
Just give me the Mermaid code that I can paste into a Mermaid renderer.
`;
