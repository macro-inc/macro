/**
 * The prose of an agent reply, ready to save as a markdown document.
 * Thoughts and tool calls stay in the transcript.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { hideIncompleteMacroXml } from '../component/parts/hideIncompleteMacroXml';

export type AgentMessageDocument = {
  title: string;
  markdown: string;
};

const TITLE_LIMIT = 80;

export function documentFromAgentProse(
  parts: MessagePart[]
): AgentMessageDocument | undefined {
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.kind !== 'text') continue;
    const text = hideIncompleteMacroXml(part.text).trim();
    if (text) chunks.push(text);
  }
  if (chunks.length === 0) return undefined;
  const markdown = chunks.join('\n\n');
  return { title: titleFromMarkdown(markdown), markdown };
}

function titleFromMarkdown(markdown: string): string {
  const lines = visibleLines(markdown);
  const heading = lines.find((line) => /^#{1,6}[ \t]+\S/.test(line));
  const chosen = heading ?? lines[0];
  const title = chosen ? plainTitle(chosen) : '';
  return clip(title || 'Untitled');
}

/** Lines a reader sees, with fenced code kept out of the title. */
function visibleLines(markdown: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && line) lines.push(line);
  }
  return lines;
}

function plainTitle(line: string): string {
  return line
    .replace(/^#{1,6}[ \t]+/, '')
    .replace(/[ \t]+#{1,6}$/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/<m-[a-zA-Z0-9_-]+>[\s\S]*?<\/m-[a-zA-Z0-9_-]+>/g, '')
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(title: string): string {
  if (title.length <= TITLE_LIMIT) return title;
  const cut = title.slice(0, TITLE_LIMIT);
  const space = cut.lastIndexOf(' ');
  return (space > 40 ? cut.slice(0, space) : cut).trimEnd();
}
