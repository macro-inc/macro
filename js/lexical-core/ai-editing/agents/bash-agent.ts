import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type LanguageModel, generateText, stepCountIs } from 'ai';
import { createTwoFilesPatch } from 'diff';
import type { SerializedEditorState } from 'lexical';
import { fromXml } from '../../transformers/xml-transformer';
import { createBashTool, truncate } from '../tools/bash';
import { interpret } from './interpret';

const read = (f: string) => fs.readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const BASH_SYSTEM = read('../prompts/BASH.md');
const INTERPRET_SYSTEM = read('../prompts/INTERPRET.md');

const MAX_DIFF = 20_000; // chars of running diff fed back per command

/**
 * Edit the XML document at `file` by letting the model run shell commands against
 * it. `onCommit` is invoked with the parsed snapshot after every command that
 * changes the file into still-valid XML; malformed intermediate states are
 * reported back to the model and skipped (never committed).
 */
export async function runBashAgent(
  file: string,
  request: string,
  model: LanguageModel,
  onCommit?: (snapshot: SerializedEditorState) => void,
  opts: { reportDiff?: boolean; interpret?: boolean } = {}
) {
  // Pristine copy for the model to diff against.
  const orig = `${file}.orig`;
  fs.copyFileSync(file, orig);
  const origContent = fs.readFileSync(file, 'utf8');
  let lastContent = origContent;

  let inputTokens = 0;
  let outputTokens = 0;

  // Optional first pass: establish intent before editing, and prepend it to the
  // edit prompt to anchor the shell agent.
  let intent = '';
  if (opts.interpret) {
    const interpretation = await interpret(origContent, request, model, INTERPRET_SYSTEM);
    inputTokens += interpretation.totalUsage.inputTokens ?? 0;
    outputTokens += interpretation.totalUsage.outputTokens ?? 0;
    intent = interpretation.text;
    console.error(`\n[intent]\n${intent}`);
  }

  const bash = createBashTool({
    description:
      'Run a shell command. The document is XML at $FILE; the pre-edit copy is at $ORIG. Edit $FILE in place.',
    env: { FILE: file, ORIG: orig },
    // Validate (and optionally diff) the edited file after every command.
    decorate: (out) => {
      const content = fs.readFileSync(file, 'utf8');
      if (content === lastContent) {
        return `${out}\n[doc] $FILE is unchanged — your command edited nothing (check that your pattern matches the real format).`;
      }
      lastContent = content;
      try {
        onCommit?.(fromXml(content));
        out += '\n[doc] saved — XML is valid.';
      } catch (e) {
        out += `\n[doc] WARNING: $FILE is not valid XML — fix it before continuing: ${(e as Error).message}`;
      }
      // Running diff vs the pre-edit document, so the model can see the
      // cumulative effect of all its edits and decide when it's satisfied.
      if (opts.reportDiff) {
        const patch = createTwoFilesPatch('before', 'after', origContent, content, '', '');
        out += `\n[diff vs original]\n${truncate(patch, MAX_DIFF)}`;
      }
      return out;
    },
  });

  const intentBlock = intent ? `\n\n<intent>\n${intent}\n</intent>` : '';
  const result = await generateText({
    model,
    stopWhen: stepCountIs(25),
    system: BASH_SYSTEM,
    prompt: `Make this edit to the document:\n${request}${intentBlock}`,
    tools: { bash },
  });
  inputTokens += result.totalUsage.inputTokens ?? 0;
  outputTokens += result.totalUsage.outputTokens ?? 0;

  return { inputTokens, outputTokens };
}
