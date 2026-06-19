import { type LanguageModel, type Tool, generateText, stepCountIs } from 'ai';
import { debugMarkdown, isDebug, nextSeq, writeDebug } from '../debug';

/**
 * First pass shared by every editing strategy: read the request together with the
 * document and produce a short statement of intent (what + why) to anchor the
 * editing that follows. Format-agnostic — the caller renders the document however
 * its strategy sees it (markdown-with-ids, XML, …) and supplies the system prompt.
 */
export async function interpret(
  documentContext: string,
  request: string,
  model: LanguageModel,
  system: string,
  tools?: Record<string, Tool>
) {
  const dbg = isDebug();
  const idx = dbg ? nextSeq() : 0;
  const prompt = `User request: ${request}\n\n${documentContext}`;
  const result = await generateText({
    model,
    system,
    prompt,
    ...(tools ? { tools, stopWhen: stepCountIs(3) } : {}),
  });
  if (dbg) writeDebug(idx, 'interpret', debugMarkdown('interpret', system, prompt, result));
  return result;
}
