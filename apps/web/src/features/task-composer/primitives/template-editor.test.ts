// @vitest-environment jsdom

import { editorStateAsMarkdown } from '@core/component/LexicalMarkdown/utils';
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import { createEditor } from 'lexical';
import { expect, it, vi } from 'vitest';
import { isTemplateStateDirty } from '../core/template-state';
import { applyTemplateToEditor } from './template-editor';

// The Markdown utility's plugin barrel imports app sockets, but no app UI is mounted.
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

it('keeps a template pristine after the real editor normalizes its Markdown', () => {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  const template = {
    propertyIds: [],
    propertyDefaults: {},
    descriptionMarkdown: '# Heading\n',
  };
  const applied = applyTemplateToEditor(template, editor);
  const editorMarkdown = editorStateAsMarkdown(editor);
  expect(editorMarkdown).not.toBe(template.descriptionMarkdown);
  expect(applied.descriptionMarkdown).toBe(editorMarkdown);
  expect(
    isTemplateStateDirty(
      { ...applied, descriptionMarkdown: editorMarkdown },
      applied
    )
  ).toBe(false);
  expect(template.descriptionMarkdown).toBe('# Heading\n');
});
