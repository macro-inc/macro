import { match } from 'ts-pattern';
import type { FormColumn, GateNode, GateRules, GateTest } from './form-model';

/** A date as rules read it: "Sep 1, 2026", in UTC like the stored value. */
export function ruleDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function joinOptions(labels: string[], conjunction: 'or' | 'and') {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} ${conjunction} ${labels.at(-1)}`;
}

function testPhrase(test: GateTest, column: FormColumn | undefined): string {
  const optionLabel = (id: string) =>
    column?.options.find((option) => option.id === id)?.label ??
    'a removed option';
  return match(test)
    .with({ kind: 'presence', operator: 'isEmpty' }, () => 'is empty')
    .with({ kind: 'presence', operator: 'isNotEmpty' }, () => 'is answered')
    .with({ kind: 'text' }, ({ operator, value }) => {
      const verb = match(operator)
        .with('is', () => 'is')
        .with('isNot', () => 'is not')
        .with('contains', () => 'contains')
        .with('doesNotContain', () => 'does not contain')
        .with('startsWith', () => 'starts with')
        .with('endsWith', () => 'ends with')
        .exhaustive();
      return `${verb} “${value}”`;
    })
    .with({ kind: 'number' }, ({ operator, value }) => {
      const verb = match(operator)
        .with('is', () => 'is')
        .with('isNot', () => 'is not')
        .with('greaterThan', () => 'is more than')
        .with('greaterThanOrEqual', () => 'is at least')
        .with('lessThan', () => 'is less than')
        .with('lessThanOrEqual', () => 'is at most')
        .exhaustive();
      return `${verb} ${value}`;
    })
    .with({ kind: 'date' }, ({ operator, value }) => {
      const verb = match(operator)
        .with('before', () => 'is before')
        .with('after', () => 'is after')
        .with('onOrBefore', () => 'is on or before')
        .with('onOrAfter', () => 'is on or after')
        .exhaustive();
      return `${verb} ${ruleDate(value)}`;
    })
    .with({ kind: 'checkbox' }, ({ checked }) =>
      checked ? 'is checked' : 'is unchecked'
    )
    .with({ kind: 'options' }, ({ operator, options }) => {
      const labels = options.map(optionLabel);
      return match(operator)
        .with('isAnyOf', () => `is ${joinOptions(labels, 'or')}`)
        .with('isNoneOf', () => `is not ${joinOptions(labels, 'or')}`)
        .with('hasAny', () => `includes ${joinOptions(labels, 'or')}`)
        .with('hasAll', () => `includes ${joinOptions(labels, 'and')}`)
        .with('hasNone', () => `includes none of ${joinOptions(labels, 'or')}`)
        .exhaustive();
    })
    .with({ kind: 'entities' }, ({ operator, entities }) => {
      const count =
        entities.length === 1 ? '1 item' : `${entities.length} items`;
      return match(operator)
        .with('isAnyOf', 'hasAny', () => `is one of ${count}`)
        .with('isNoneOf', 'hasNone', () => `is none of ${count}`)
        .with('hasAll', () => `includes all of ${count}`)
        .exhaustive();
    })
    .exhaustive();
}

function nodeSentence(
  node: GateNode,
  columns: ReadonlyMap<string, FormColumn>
): string {
  if (node.kind === 'group') return `(${groupSentence(node, columns)})`;
  const column = columns.get(node.column);
  return `${column?.name ?? 'A removed question'} ${testPhrase(node.test, column)}`;
}

function groupSentence(
  rules: GateRules,
  columns: ReadonlyMap<string, FormColumn>
): string {
  return rules.conditions
    .map((node) => nodeSentence(node, columns))
    .join(rules.conjunction === 'and' ? ' AND ' : ' OR ');
}

/** A gate's rules as one line: "IF Team is not Contractor AND Start date is before Sep 1, 2026". */
export function rulesSentence(
  rules: GateRules | null,
  columns: ReadonlyMap<string, FormColumn>
): string | undefined {
  if (!rules || rules.conditions.length === 0) return undefined;
  return `IF ${groupSentence(rules, columns)}`;
}
