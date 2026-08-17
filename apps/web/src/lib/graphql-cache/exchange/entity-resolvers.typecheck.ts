import {
  type EntityResolverConfig,
  entityFromArgument,
} from './entity-resolvers';

// The public inline API retains its literals without explicit generics or
// `as const`.
const inlineConfig: EntityResolverConfig = {
  GraphqlUser: {
    emailThread: entityFromArgument('GraphqlSoupEmailThread', [
      'input',
      'threadId',
    ]),
  },
};

const extractedConfig = {
  GraphqlUser: {
    emailThread: entityFromArgument('GraphqlSoupEmailThread', [
      'input',
      'threadId',
    ]),
  },
} satisfies EntityResolverConfig;

const invalidParent: EntityResolverConfig = {
  // @ts-expect-error Unknown parent type.
  GraphqlTypo: {},
};

const invalidField: EntityResolverConfig = {
  GraphqlUser: {
    // @ts-expect-error Unknown field on a valid parent.
    emailTypo: entityFromArgument('GraphqlSoupEmailThread', [
      'input',
      'threadId',
    ]),
  },
};

const scalarField: EntityResolverConfig = {
  GraphqlUser: {
    // @ts-expect-error Scalar fields are not eligible entity relations.
    id: entityFromArgument('GraphqlSoupEmailThread', ['input', 'threadId']),
  },
};

const listField: EntityResolverConfig = {
  GraphqlUser: {
    // @ts-expect-error List-returning fields are not eligible.
    propertyDefinitions: entityFromArgument('GraphqlProperty', [
      'input',
      'propertyDefinitionId',
    ]),
  },
};

const embeddedField: EntityResolverConfig = {
  GraphqlUser: {
    // @ts-expect-error Embedded/non-entity fields are not eligible.
    soup: entityFromArgument('GraphqlSoupEmailThread', ['input', 'threadId']),
  },
};

// @ts-expect-error Unknown target typename.
entityFromArgument('GraphqlSoupEmailTread', ['input', 'threadId']);

const incompatibleTarget: EntityResolverConfig = {
  GraphqlUser: {
    // @ts-expect-error Valid entity typename, incompatible with emailThread.
    emailThread: entityFromArgument('GraphqlProperty', ['input', 'threadId']),
  },
};

// @ts-expect-error Typo in the first argument-path segment.
entityFromArgument('GraphqlSoupEmailThread', ['inpt', 'threadId']);

// @ts-expect-error Typo in the ID argument-path leaf.
entityFromArgument('GraphqlSoupEmailThread', ['input', 'threadID']);

const pathForAnotherField: EntityResolverConfig = {
  GraphqlUser: {
    // @ts-expect-error Globally valid ID path, but not for emailThread.
    emailThread: entityFromArgument('GraphqlSoupEmailThread', [
      'input',
      'channelId',
    ]),
  },
};

// @ts-expect-error The path leaf is not a GraphQL ID anywhere eligible.
entityFromArgument('GraphqlSoupEmailThread', ['input', 'limit']);

void [
  inlineConfig,
  extractedConfig,
  invalidParent,
  invalidField,
  scalarField,
  listField,
  embeddedField,
  incompatibleTarget,
  pathForAnotherField,
];
