import ClaudeIcon from '@icon/wide-claude.svg';
import OpenAiIcon from '@icon/wide-codex-ide.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import OpenCodeIcon from '@icon/wide-opencode.svg';
import { describe, expect, it } from 'vitest';
import { mcpClientMark } from './mcpClientMark';

describe('mcpClientMark', () => {
  it('draws each verified product with its own mark', () => {
    expect(mcpClientMark('claude')?.Icon).toBe(ClaudeIcon);
    expect(mcpClientMark('claude_code')?.Icon).toBe(ClaudeIcon);
    expect(mcpClientMark('cursor')?.Icon).toBe(CursorIcon);
    expect(mcpClientMark('codex')?.Icon).toBe(OpenAiIcon);
    expect(mcpClientMark('chatgpt')?.Icon).toBe(OpenAiIcon);
    expect(mcpClientMark('opencode')?.Icon).toBe(OpenCodeIcon);
  });

  it('gives an unverified client no mark', () => {
    expect(mcpClientMark(null)).toBeUndefined();
    expect(mcpClientMark(undefined)).toBeUndefined();
  });
});
