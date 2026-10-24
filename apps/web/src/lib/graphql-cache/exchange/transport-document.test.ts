import { parse, print } from 'graphql';
import { describe, expect, it } from 'vitest';
import { hasClientDirectives, transportDocument } from './transport-document';

const transport = (query: string) => print(transportDocument(parse(query)));

describe('transportDocument', () => {
  it('removes @fromCache fields and strips @cacheOnly from fetched fields', () => {
    expect(
      transport(`
        query Page($threadId: ID!) {
          user {
            id @cacheOnly
            emailThread(input: { threadId: $threadId }) {
              messages {
                id
                body: preparedBody(version: 1) @fromCache { html }
                ... on GraphqlSoupEmailMessage {
                  preparedBody(version: 1) @fromCache { version }
                }
              }
            }
          }
        }
      `)
    ).toBe(
      print(
        parse(`
          query Page($threadId: ID!) {
            user {
              id
              emailThread(input: { threadId: $threadId }) {
                messages {
                  id
                  ... on GraphqlSoupEmailMessage { __typename }
                }
              }
            }
          }
        `)
      )
    );
  });

  it('keeps an emptied parent and drops fragments and variables only removed fields used', () => {
    expect(
      transport(`
        query Bodies($id: ID!, $version: Int!) {
          message(id: $id) {
            preparedBody(version: $version) @fromCache { ...Body }
          }
          other: message(id: $id) { ...Kept }
        }
        fragment Body on GraphqlPreparedEmailBody { html ...Nested }
        fragment Nested on GraphqlPreparedEmailBody { version }
        fragment Kept on GraphqlSoupEmailMessage { id }
      `)
    ).toBe(
      print(
        parse(`
          query Bodies($id: ID!) {
            message(id: $id) { __typename }
            other: message(id: $id) { ...Kept }
          }
          fragment Kept on GraphqlSoupEmailMessage { id }
        `)
      )
    );
  });

  it('leaves documents without client directives unchanged', () => {
    const query =
      'query Soup($input: SoupInput!) {\n  soup(input: $input) {\n    id @include(if: true)\n  }\n}';
    expect(hasClientDirectives(query)).toBe(false);
    expect(transport(query)).toBe(query);
  });
});
