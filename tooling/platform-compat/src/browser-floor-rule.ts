import bcd from '@mdn/browser-compat-data' with { type: 'json' };
import type { Rule, Scope, SourceCode } from 'eslint';
import type * as ESTree from 'estree';
import { parseBrowserFloor, WEB_BROWSER_FLOOR } from './browser-floor';
import {
  constructorFeature,
  type Feature,
  globalFeature,
  memberFeature,
  missingSupport,
  regexFeatures,
} from './compat-data';

const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);

function isTypeOnly(reference: object): boolean {
  return (
    'isValueReference' in reference && reference.isValueReference === false
  );
}

function exits(statement: ESTree.Statement): boolean {
  switch (statement.type) {
    case 'ReturnStatement':
    case 'ThrowStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return true;
    case 'BlockStatement': {
      const last = statement.body.at(-1);
      return last !== undefined && exits(last);
    }
    default:
      return false;
  }
}

function precedingStatements(
  parent: ESTree.Node,
  child: ESTree.Node
): readonly ESTree.Node[] {
  const body =
    parent.type === 'BlockStatement' ||
    parent.type === 'Program' ||
    parent.type === 'StaticBlock'
      ? parent.body
      : parent.type === 'SwitchCase'
        ? parent.consequent
        : [];
  const index = body.findIndex((statement) => statement === child);
  return index < 0 ? [] : body.slice(0, index);
}

/**
 * Whether the use sits behind a feature check: an optional call or access,
 * `typeof`, the test of a condition, a branch whose condition names the
 * feature, an earlier early-exit check, or a `try` block.
 */
function isGuarded(
  chain: readonly ESTree.Node[],
  featureName: string,
  sourceCode: SourceCode
): boolean {
  const node = chain.at(-1);
  const parent = chain.at(-2);
  if (
    node?.type === 'MemberExpression' &&
    ((parent?.type === 'MemberExpression' &&
      parent.object === node &&
      parent.optional) ||
      (parent?.type === 'CallExpression' &&
        parent.callee === node &&
        parent.optional))
  ) {
    return true;
  }
  const namePattern = new RegExp(
    `\\b${featureName.replace(/[$]/g, '\\$&')}\\b`
  );
  const mentions = (test: ESTree.Node) =>
    namePattern.test(sourceCode.getText(test));
  for (let index = chain.length - 1; index > 0; index--) {
    const child = chain[index];
    const ancestor = chain[index - 1];
    switch (ancestor.type) {
      case 'UnaryExpression':
        if (ancestor.operator === 'typeof') return true;
        break;
      case 'IfStatement':
      case 'ConditionalExpression':
        if (child === ancestor.test || mentions(ancestor.test)) return true;
        break;
      case 'LogicalExpression':
        if (child === ancestor.left || mentions(ancestor.left)) return true;
        break;
      case 'TryStatement':
        if (child === ancestor.block) return true;
        break;
      default:
        for (const statement of precedingStatements(ancestor, child)) {
          if (
            statement.type === 'IfStatement' &&
            exits(statement.consequent) &&
            mentions(statement.test)
          ) {
            return true;
          }
        }
    }
  }
  return false;
}

function stringArgument(node: ESTree.Node | undefined): string | undefined {
  return node?.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : undefined;
}

export const browserFloorRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow web platform features that the browsers in apps/web/package.json `browserslist` lack, unless feature-detected',
    },
    schema: [
      {
        type: 'object',
        properties: {
          browserslist: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unsupported:
        '{{feature}} is missing in {{browser}} {{floor}} ({{added}}), which apps/web/package.json `browserslist` supports. Feature-detect it, add a fallback, or raise the floor.',
    },
  },
  create(context) {
    const options: { browserslist?: string[] } | undefined = context.options[0];
    const floor = options?.browserslist
      ? parseBrowserFloor(options.browserslist)
      : WEB_BROWSER_FLOOR;
    const sourceCode = context.sourceCode;

    function report(
      found: Feature | undefined,
      node: ESTree.Node,
      label: string,
      chain: readonly ESTree.Node[],
      featureName: string
    ) {
      if (!found) return;
      const missing = missingSupport(found.compat, floor);
      if (!missing || isGuarded(chain, featureName, sourceCode)) return;
      context.report({
        node,
        messageId: 'unsupported',
        data: {
          feature: label,
          browser: bcd.browsers[missing.browser].name,
          floor: missing.floorVersion,
          added: missing.addedVersion
            ? `added in ${missing.addedVersion}`
            : 'never released there',
        },
      });
    }

    function checkGlobalReference(reference: Scope.Reference) {
      const identifier = reference.identifier;
      if (identifier.type !== 'Identifier' || isTypeOnly(reference)) return;
      const ancestors = sourceCode.getAncestors(identifier);
      const parent = ancestors.at(-1);
      const name = identifier.name;

      if (
        parent?.type === 'MemberExpression' &&
        parent.object === identifier &&
        !parent.computed &&
        parent.property.type === 'Identifier'
      ) {
        const property = parent.property.name;
        const label = GLOBAL_OBJECTS.has(name)
          ? property
          : `${name}.${property}`;
        report(
          memberFeature(name, property),
          parent,
          label,
          ancestors,
          property
        );
      }
      if (GLOBAL_OBJECTS.has(name)) return;

      const chain = [...ancestors, identifier];
      const invoked =
        (parent?.type === 'NewExpression' ||
          parent?.type === 'CallExpression') &&
        parent.callee === identifier
          ? parent
          : undefined;
      if (invoked?.type === 'NewExpression') {
        report(
          constructorFeature(name),
          identifier,
          `new ${name}()`,
          chain,
          name
        );
      } else {
        report(globalFeature(name), identifier, name, chain, name);
      }

      const pattern =
        name === 'RegExp' ? stringArgument(invoked?.arguments[0]) : undefined;
      if (invoked && pattern !== undefined) {
        for (const found of regexFeatures(
          pattern,
          stringArgument(invoked.arguments[1]) ?? ''
        )) {
          report(found, invoked, found.key, ancestors, name);
        }
      }
    }

    return {
      Literal(node) {
        if (!('regex' in node) || !node.regex) return;
        for (const found of regexFeatures(
          node.regex.pattern,
          node.regex.flags
        )) {
          report(found, node, found.key, [], found.key);
        }
      },
      'Program:exit'(program) {
        const globalScope = sourceCode.getScope(program);
        for (const reference of globalScope.through)
          checkGlobalReference(reference);
        for (const variable of globalScope.variables) {
          if (variable.defs.length > 0) continue;
          for (const reference of variable.references)
            checkGlobalReference(reference);
        }
      },
    };
  },
};
