import { createBlockSignal } from '@core/block';
import { replaceCitations } from '@core/component/LexicalMarkdown/citationsUtils';
import type { generateCallback } from '@core/component/LexicalMarkdown/component/menu/GenerateMenu';
import type {
  Completion,
  GenerateMenuOpen,
} from '@core/component/LexicalMarkdown/plugins';
import { cognitionWebsocketServiceClient } from '@service-cognition/client';
import { createCognitionWebsocketBlockEffect } from '@service-cognition/websocket';
import { uuid } from 'short-uuid';

// Generating simple completion
export const isGeneratingSignal = createBlockSignal<boolean>(false);

// Done generating and waiting for user input
export const generatedAndWaitingSignal = createBlockSignal<boolean>(false);

export const completionSignal = createBlockSignal<Completion>();
export const generateMenuSignal: GenerateMenuOpen = createBlockSignal();
export const generateContextSignal = createBlockSignal<string>();
export const generateCompletionId = createBlockSignal('');

export const generateNotesSignal = createBlockSignal<boolean>(false);

export const generateContentCallback: generateCallback = (
  userRequest: string
) => {
  const context = generateContextSignal() ?? '';
  const id = uuid();
  generateCompletionId.set(id.toString());

  cognitionWebsocketServiceClient.streamSimpleCompletion({
    prompt: `${PROMPT}${context}`,
    user_request: userRequest,
    completion_id: id,
  });
};

createCognitionWebsocketBlockEffect('completion_stream_chunk', (data) => {
  if (!isGeneratingSignal()) {
    return;
  }
  const setIsGeneratingSignal = isGeneratingSignal.set;
  const setGeneratedAndWaitingSignal = generatedAndWaitingSignal.set;
  const [, setCompletionSignal] = completionSignal;
  let text = data.content;

  if (data.done) {
    replaceCitations(text).then((replacedText) => {
      setCompletionSignal((prev) => {
        if (prev) {
          return {
            ...prev,
            text: replacedText,
            doneGenerating: data.done,
          };
        }
      });

      setGeneratedAndWaitingSignal(true);
      setIsGeneratingSignal(false);
    });
  } else {
    text = text.replace(/\[\[.*?\]\]/g, '');
    setCompletionSignal((prev) => {
      if (prev) {
        return {
          ...prev,
          text,
          doneGenerating: data.done,
        };
      }
    });
  }
});

export const generateNotesContentCallback = (documentIds: string[]) => {
  const id = uuid();
  generateCompletionId.set(id);
  cognitionWebsocketServiceClient.streamSimpleCompletion({
    prompt: PROMPT,
    user_request: NOTES_PROMPTS,
    model: 'anthropic/claude-sonnet-4',
    content_document_ids: documentIds,
    completion_id: id,
  });
};

export const PROMPT = `You are a helpful writing assistant. You will use provided context with a user selection to answer user queries.
Users will ask you to write things. Your response will be directly inserted into their document.
Format your response in VALID Github Flavored Markdown (GFM) and respond directly to the user's request without comment.
Do NOT use code fences for markdown. Only use code fences for code. Once again, do NOT use code fences for markdown.
Your response will be directly inserted into the document so if you are unable to response, respond with an empty string.
Your response will be directly inserted into the context where it is marked with [[SELECTION]].
Your context is as follows:

`;

const NOTES_PROMPTS = `Take the provided document and create clear, well-structured, and CONCISE notes that:
Identify key concepts, themes, and their relationships.
Organize ideas hierarchically with clear headings and subheadings.
Use bullet points and numbered lists for readability.
Provide relevant examples or applications when helpful.
Summarize complex points in simple, concise, accessible language.
Use latex equations and tables where helpful.
Only use $$ for latex equations. \\(x_i\\) is NOT valid math, do NOT use it. Use $$x_i$$. Equations should also be in one line. Do NOT make them multiline.
Make sure you include citations within the document of the format [[uuid]].
End with 2-3 key takeaways or insights for quick review

`;
