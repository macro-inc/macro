import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ViewSchema } from './schema';
import { displayResultsToolSchema } from './toolSchema';

const GENERATED = resolve(
  import.meta.dirname,
  '../../../../../crates/ai_tools/src/display_results/schema.generated.json'
);

describe('DisplayResults tool contract', () => {
  it('matches the complete schema included by the Rust tool', () => {
    expect(readFileSync(GENERATED, 'utf8')).toBe(
      `${JSON.stringify(displayResultsToolSchema(), null, 2)}\n`
    );
  });

  it('resolves recursive widgets from the tool root and accepts renderer views', () => {
    // Read the artifact the backend sends, rather than relying on the original
    // Zod object: broken or misplaced $defs must fail this round trip.
    const contract = z.fromJSONSchema(
      JSON.parse(readFileSync(GENERATED, 'utf8'))
    );
    const view = {
      title: 'Project overview',
      widgets: [
        {
          type: 'container',
          direction: 'row',
          children: [
            {
              type: 'container',
              children: [{ type: 'md', markdown: 'Hello' }],
            },
            {
              type: 'list',
              source: {
                kind: 'items',
                entities: [{ type: 'document', id: 'doc-1' }],
              },
            },
            {
              type: 'timeline',
              events: [
                {
                  time: 'Today',
                  title: 'Reviewed',
                  entity: { type: 'document', id: 'doc-1' },
                },
              ],
            },
            {
              type: 'channelMessage',
              channelId: 'channel-1',
              messageId: 'message-1',
            },
          ],
        },
      ],
    };
    expect(ViewSchema.safeParse(view).success).toBe(true);
    expect(contract.safeParse({ view }).success).toBe(true);
  });

  it.each([
    {},
    { view: {} },
    { view: { widgets: [{ type: 'unknown' }] } },
    { view: { widgets: [{ type: 'container', children: [{ type: 'md' }] }] } },
    {
      view: {
        widgets: [
          {
            type: 'list',
            source: {
              kind: 'items',
              entities: [{ id: 'doc-1', type: 'invented' }],
            },
          },
        ],
      },
    },
  ])('rejects malformed tool arguments: %j', (args) => {
    const contract = z.fromJSONSchema(displayResultsToolSchema());
    expect(contract.safeParse(args).success).toBe(false);
  });

  it('advertises rendering guidance on the tool itself', () => {
    const schema = displayResultsToolSchema();
    expect(schema.title).toBe('DisplayResults');
    expect(schema.description).toContain('ReadActivity');
    expect(schema.description).toContain('never invent ids');
    expect(schema.required).toEqual(['view']);
  });
});
