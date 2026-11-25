import {
  type NotionReference,
  parseNotionReference,
} from '@macro-inc/lexical-core/notion/links';
import { OpenAPIRoute } from 'chanfana';
import type { Context } from 'hono';
import { LoroDoc, LoroMap, LoroMovableList } from 'loro-crdt';
import { z } from 'zod';
import { standardErrorResponses } from '../lib/schemas';

const MAX_REFERENCES = 256;
const MAX_ENCODED_SNAPSHOT = Math.ceil((4 * 1024 * 1024) / 3) * 4;
const sourceId = z.string().regex(/^[0-9a-f]{32}$/);
const source = z.object({ id: sourceId, viewId: sourceId.optional() });
const replacement = source.extend({
  destination: z.discriminatedUnion('type', [
    z.object({ type: z.literal('page'), documentId: z.string().uuid() }),
    z.object({
      type: z.literal('database'),
      databaseId: z.string().uuid(),
      tableId: z.string().uuid(),
      viewId: z.string().uuid().optional(),
    }),
  ]),
});

function key({ id, viewId }: NotionReference): string {
  return `${id}:${viewId ?? ''}`;
}

function destinationUrl(dest: z.infer<typeof replacement>['destination']) {
  if (dest.type === 'page') return `/app/md/${dest.documentId}`;
  const params = new URLSearchParams({ tableId: dest.tableId });
  if (dest.viewId) params.set('viewId', dest.viewId);
  return `/app/database/${dest.databaseId}?${params}`;
}

/** Inspect or change only the href registers of existing collaborative link nodes. */
export function notionLinkDelta(
  snapshot: Uint8Array,
  replacements: z.infer<typeof replacement>[]
) {
  const doc = new LoroDoc();
  try {
    doc.import(snapshot);
    const from = doc.oplogVersion();
    const revision = Buffer.from(from.encode()).toString('base64');
    const targets = new Map(
      replacements.map((item) => [key(item), item.destination])
    );
    const references = new Map<string, NotionReference>();
    let rewritten = 0;
    const stack = [doc.getMap('root')];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) break;
      const type = node.get('type');
      if (type === 'code' || type === 'custom-code') continue;
      const href = node.get('url');
      if (
        (type === 'link' || type === 'autolink') &&
        typeof href === 'string'
      ) {
        const reference = parseNotionReference(href);
        if (reference) {
          const referenceKey = key(reference);
          if (references.size < MAX_REFERENCES)
            references.set(referenceKey, reference);
          const destination = targets.get(referenceKey);
          if (destination) {
            node.set('url', destinationUrl(destination));
            rewritten += 1;
          }
        }
      }
      const children = node.get('children');
      if (children instanceof LoroMovableList) {
        for (let index = children.length - 1; index >= 0; index -= 1) {
          const child = children.get(index);
          if (child instanceof LoroMap) stack.push(child);
        }
      }
    }
    doc.commit();
    const update = rewritten
      ? Buffer.from(doc.export({ mode: 'update', from })).toString('base64')
      : undefined;
    return {
      revision,
      references: [...references.values()],
      rewritten,
      update,
    };
  } finally {
    doc.free();
  }
}

export class NotionLinksEndpoint extends OpenAPIRoute {
  schema = {
    summary: 'Prepare a link-only update to an imported Notion document',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              snapshot: z.string().max(MAX_ENCODED_SNAPSHOT),
              replacements: z.array(replacement).max(MAX_REFERENCES),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Exact Notion references and an optional Loro delta',
        content: {
          'application/json': {
            schema: z.object({
              revision: z.string(),
              references: z.array(source),
              rewritten: z.number(),
              update: z.string().optional(),
            }),
          },
        },
      },
      ...standardErrorResponses,
    },
  };

  async handle(c: Context) {
    const { body } = await this.getValidatedData<typeof this.schema>();
    try {
      return c.json(
        notionLinkDelta(Buffer.from(body.snapshot, 'base64'), body.replacements)
      );
    } catch {
      return c.json({ error: 'Invalid document snapshot' }, 400);
    }
  }
}
