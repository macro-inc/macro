import Handlebars from 'handlebars/dist/handlebars.js';
import { DocumentEditor } from '../ai-editing/editor/document-editor';
import editorDocs from '../ai-editing/prompts/API_COMPLETE.md';
import { sdkDocs } from './sdk-docs';

export type HostCall = (name: string, input: unknown) => Promise<unknown>;

export type DocumentState = {
  documentId: string;
  revision: string;
  xml: string;
  state: Record<string, unknown>;
  nodeIds: string[];
};

export type GenerateOptions = {
  model?: 'fast' | 'good';
  prompt: string;
  system?: string;
  maxOutputTokens?: number;
};

export type Generation = {
  text: string;
  object?: unknown;
  model: string;
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number };
};

/** Pure helpers run here; every remote capability still crosses host policy. */
export function createSdk(call: HostCall) {
  const handlebars = Handlebars.create();
  const api = {
    async help(topic = ''): Promise<unknown> {
      if (topic === 'documents.editor') return editorDocs;
      if (Object.hasOwn(sdkDocs, topic)) return sdkDocs[topic];
      return call('DescribeCodeSdk', {
        names: topic && topic !== 'tools' ? [topic] : [],
      });
    },
    documents: {
      async open({ documentId }: { documentId: string }) {
        const snapshot = (await call('ReadDocumentState', {
          documentId,
        })) as DocumentState;
        const editor = new DocumentEditor({
          validIds: snapshot.nodeIds,
          refs: Array.from({ length: 200 }, () => crypto.randomUUID()),
        });
        let saved = false;
        return Object.freeze({
          ...snapshot,
          editor,
          async save() {
            if (saved)
              throw new Error(
                'This handle was already saved. Open a fresh document before editing again.'
              );
            // Claim before awaiting: simultaneous saves must never replay a batch.
            saved = true;
            const operations = editor.drain();
            if (operations.length === 0)
              return {
                documentId,
                revision: snapshot.revision,
                applied: false,
              };
            return call('ApplyDocumentOperations', {
              documentId,
              expectedRevision: snapshot.revision,
              operations,
            });
          },
        });
      },
    },
    ai: {
      async generateText(options: GenerateOptions): Promise<Generation> {
        return (await call('GenerateCodeText', options)) as Generation;
      },
      async generateObject(
        options: GenerateOptions & { schema: Record<string, unknown> }
      ): Promise<Generation> {
        return (await call('GenerateCodeObject', options)) as Generation;
      },
    },
    templates: {
      render(
        template: string,
        data: unknown,
        options: { escape?: boolean } = {}
      ) {
        const bytes = (text: string) => new TextEncoder().encode(text).length;
        if (typeof template !== 'string' || bytes(template) > 32_768)
          throw new Error('Template must be a string of at most 32 KiB.');
        const serialized = JSON.stringify(data);
        if (!serialized || bytes(serialized) > 128 * 1024)
          throw new Error('Template data must be JSON, at most 128 KiB.');
        // JSON removes callable values/prototypes. No registration or runtime options
        // are exposed; the instance is private to this execution.
        const rendered = handlebars.compile(template, {
          strict: true,
          noEscape: options.escape === false,
          knownHelpersOnly: true,
        })(JSON.parse(serialized), {
          allowProtoMethodsByDefault: false,
          allowProtoPropertiesByDefault: false,
        });
        if (bytes(rendered) > 256 * 1024)
          throw new Error('Rendered template exceeds 256 KiB.');
        return rendered;
      },
    },
  };
  Object.values(api).forEach(Object.freeze);
  return new Proxy(Object.freeze(api), {
    get(target, name, receiver) {
      if (typeof name !== 'string' || name === 'then') return undefined;
      if (Object.hasOwn(target, name))
        return Reflect.get(target, name, receiver);
      return (input: unknown = {}) => call(name, input);
    },
  });
}
