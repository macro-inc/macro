import { ChannelDetailSoupDocument } from '@service-storage/graphql/generated/graphql';
import { type FieldNode, Kind, print, visit } from 'graphql';
import { describe, expect, it } from 'vitest';

describe('channel detail document', () => {
  it('selects only unread notifications, never the read history', () => {
    const edges: FieldNode[] = [];
    visit(ChannelDetailSoupDocument, {
      Field(node) {
        if (node.name.value === 'notifications') edges.push(node);
      },
    });
    expect(edges).toHaveLength(1);
    const filter = edges[0].arguments?.find(
      (argument) => argument.name.value === 'filter'
    );
    expect(filter?.value.kind).toBe(Kind.OBJECT);
    expect(filter && print(filter.value)).toBe('{states: [UNSEEN]}');
  });
});
