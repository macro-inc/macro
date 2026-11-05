import type { CacheHost } from '@app/lib/graphql-cache/host/types';
import type {
  GraphqlCrmContactExpr,
  GraphqlCrmContactFieldsFragment,
  SoupInput,
} from '@service-storage/graphql/generated/graphql';
import { createClient, fetchExchange } from '@urql/core';
import { createSignal } from 'solid-js';
import {
  contacts,
  failRead,
  role,
  setFailRead,
  userId,
} from './preview-adapters';

export const [requests, setRequests] = createSignal<SoupInput[]>([]);
export const [holdNextRead, setHoldNextRead] = createSignal(false);
export const [readHeld, setReadHeld] = createSignal(false);
let release: (() => void) | undefined;
export function releaseRead() {
  release?.();
}
export function usePending() {}
export const useFlowTrace = () => undefined;
export function getGraphqlSoupCacheHost(): CacheHost | undefined {
  return undefined;
}
export const hasGraphqlCacheHost = () => false;
export const graphqlSoupProjectionSupported = () => true;
export const normalizedCacheResultMetadata = () => undefined;
const deleted = new Set<string>();
export const usePendingGraphqlSoupDeleteKeys = () => () => deleted;
export function withoutPendingSoupEntities<T>(entities: T[]) {
  return entities;
}

// Synthetic API boundary. Filtering and authorization happen before paging;
// the browser uses the production AST compiler and live GraphQL page source.
function matches(
  contact: (typeof contacts)[number],
  expr: GraphqlCrmContactExpr
): boolean {
  if (expr.and)
    return matches(contact, expr.and.left) && matches(contact, expr.and.right);
  if (expr.or)
    return matches(contact, expr.or.left) || matches(contact, expr.or.right);
  if (expr.not) return !matches(contact, expr.not);
  const literal = expr.literal;
  if (literal.hidden !== undefined)
    return (contact.hidden || contact.parentHidden) === literal.hidden;
  if (literal.teamId !== undefined) return contact.teamId === literal.teamId;
  if (literal.search !== undefined)
    return `${contact.name} ${contact.email}`
      .toLowerCase()
      .includes(literal.search.toLowerCase());
  if (literal.id !== undefined) return contact.id === literal.id;
  if (literal.companyId !== undefined)
    return contact.companyId === literal.companyId;
  if (literal.email !== undefined) return contact.email === literal.email;
  return literal.include === true;
}
const cursors = new Map<
  string,
  {
    filter: GraphqlCrmContactExpr;
    after: string;
    limit: number;
    viewer: string;
  }
>();
let cursorId = 0;
const client = createClient({
  url: '/fixture-graphql',
  exchanges: [fetchExchange],
  fetch: async (_url, init) => {
    const { variables }: { variables: { input: SoupInput } } = JSON.parse(
      String(init?.body)
    );
    const input = variables.input;
    setRequests((previous) => [...previous, input]);
    if (failRead()) {
      setFailRead(false);
      return new Response(
        JSON.stringify({ errors: [{ message: 'Fixture query unavailable' }] }),
        { headers: { 'content-type': 'application/json' } }
      );
    }
    const cursor = input.continuation
      ? cursors.get(input.continuation.cursor)
      : undefined;
    const filter = input.initial?.filters?.crmContactFilter ?? cursor?.filter;
    const limit = input.initial?.limit ?? cursor?.limit ?? 2;
    const rows =
      filter && (!cursor || cursor.viewer === userId())
        ? contacts
            .filter(
              (contact) =>
                // Fixture viewer belongs to both teams; the production removed filter
                // must still exclude the other team's records before pagination.
                (role() !== 'member' ||
                  !(contact.hidden || contact.parentHidden)) &&
                matches(contact, filter)
            )
            .sort((a, b) => a.id.localeCompare(b.id))
        : [];
    const after = cursor
      ? rows.findIndex((row) => row.id === cursor.after) + 1
      : 0;
    const page = rows.slice(after, after + limit);
    let nextCursor: string | null = null;
    if (filter && after + limit < rows.length) {
      nextCursor = `cursor-${++cursorId}`;
      cursors.set(nextCursor, {
        filter,
        after: page[page.length - 1].id,
        limit,
        viewer: userId(),
      });
    }
    const items: GraphqlCrmContactFieldsFragment[] = page.map((contact) => ({
      __typename: 'GraphqlSoupCrmContact',
      id: contact.id,
      hidden: contact.hidden || contact.parentHidden,
      contactTeamId: contact.teamId,
      contactCompanyId: contact.companyId ?? null,
      contactCompanyName: contact.companyId ? 'Example company' : null,
      crmContactName: contact.name ?? null,
      contactEmail: contact.email ?? null,
      firstInteraction: contact.firstInteraction,
      lastInteraction: contact.lastInteraction,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
      viewedAt: null,
    }));
    if (holdNextRead()) {
      setHoldNextRead(false);
      setReadHeld(true);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      release = undefined;
      setReadHeld(false);
    }
    return new Response(
      JSON.stringify({ data: { user: { soup: { items, nextCursor } } } }),
      { headers: { 'content-type': 'application/json' } }
    );
  },
});
export const getGraphqlSoupClient = () => client;
