import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ViewSchema } from './schema';
import { showToolSchema } from './toolSchema';

const GENERATED = resolve(
  import.meta.dirname,
  '../../../../../crates/ai_tools/src/show/schema.generated.json'
);

describe('Show tool contract', () => {
  it('matches the complete schema included by the Rust tool', () => {
    expect(readFileSync(GENERATED, 'utf8')).toBe(
      `${JSON.stringify(showToolSchema(), null, 2)}\n`
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
            {
              type: 'tags',
              title: 'Company tags',
              tags: [
                {
                  label: 'Area',
                  children: [
                    {
                      label: 'Platform',
                      color: 'teal',
                      children: [
                        {
                          label: 'infra',
                          color: '#FFB224',
                          description: 'Cloud and CI/CD',
                          tagId: 'tag-1',
                        },
                      ],
                    },
                  ],
                },
              ],
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
    { view: { widgets: [{ type: 'tags', tags: [{ color: 'red' }] }] } },
    {
      view: {
        widgets: [
          {
            type: 'tags',
            tags: [{ label: 'Area', children: [{ description: 'No name' }] }],
          },
        ],
      },
    },
  ])('rejects malformed tool arguments: %j', (args) => {
    const contract = z.fromJSONSchema(showToolSchema());
    expect(contract.safeParse(args).success).toBe(false);
  });

  it('advertises rendering guidance on the tool itself', () => {
    const schema = showToolSchema();
    expect(schema.title).toBe('Show');
    expect(schema.description).toContain(
      'What ReadActivity returns is not shown to the user by itself'
    );
    expect(schema.description).toContain('never invent ids');
    expect(schema.description).toContain(
      'Never mention, link or name in your reply an item the view shows'
    );
    // The agent shows what matters without being asked, and only that.
    expect(schema.description).toContain('the user will not ask');
    expect(schema.description).toContain(
      'Show the smallest set that does the job'
    );
    expect(schema.required).toEqual(['view']);
  });
});
