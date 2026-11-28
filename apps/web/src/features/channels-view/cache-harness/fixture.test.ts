import { describe, expect, it } from 'vitest';
import { createChatFixture } from './fixture';

type Page = { items: unknown[]; nextCursor: string | null };
type SoupRoot = {
  user: { soup(args: { input: unknown }): Page };
};

function firstPage(limit?: number | null) {
  const fixture = createChatFixture(700);
  const root = fixture.rootValue() as SoupRoot;
  const page = root.user.soup({
    input: { initial: limit === undefined ? {} : { limit } },
  });
  return { page, reads: fixture.reads() };
}

describe('the Chat cache harness fixture', () => {
  it('pages as GraphQL Soup does: 20 rows by default, a limit kept to 1–500', () => {
    expect(firstPage().page.items).toHaveLength(20);
    expect(firstPage(null).page.items).toHaveLength(20);
    expect(firstPage(0).page.items).toHaveLength(1);
    expect(firstPage(100).page.items).toHaveLength(100);
    expect(firstPage(600).page.items).toHaveLength(500);
  });

  it('faults a limit the schema refuses, instead of serving a page', () => {
    for (const limit of [-1, 65_536, 2.5]) {
      const { page, reads } = firstPage(limit);
      expect(page).toEqual({ items: [], nextCursor: null });
      expect(reads.unsupported).toEqual([`limit ${limit}`]);
    }
  });

  it('gives a full last page a cursor to one more, empty page', () => {
    const fixture = createChatFixture(500);
    const root = fixture.rootValue() as SoupRoot;
    const first = root.user.soup({ input: { initial: { limit: 500 } } });
    expect(first.items).toHaveLength(500);
    expect(first.nextCursor).not.toBeNull();
    const rest = root.user.soup({
      input: { continuation: { cursor: first.nextCursor } },
    });
    expect(rest).toEqual({ items: [], nextCursor: null });
    expect(fixture.reads().unsupported).toEqual([]);
  });

  it('ends a short page without a cursor', () => {
    const fixture = createChatFixture(700);
    const root = fixture.rootValue() as SoupRoot;
    const first = root.user.soup({ input: { initial: { limit: 500 } } });
    expect(first.items).toHaveLength(500);
    const rest = root.user.soup({
      input: { continuation: { cursor: first.nextCursor } },
    });
    expect(rest.items).toHaveLength(200);
    expect(rest.nextCursor).toBeNull();
  });
});
