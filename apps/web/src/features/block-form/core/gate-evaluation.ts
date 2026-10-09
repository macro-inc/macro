import { match } from 'ts-pattern';
import type {
  FormCellValue,
  GateNode,
  GateRules,
  GateTest,
  SetOperator,
} from './form-model';

/**
 * Whether answers pass a gate's rules, by column id. The server is the
 * authority; this lets "Next" show the stop screen before submitting.
 *
 * Forms are stricter than a view's filter: an absent or cleared answer fails
 * every test but `isEmpty` (`isNot` and `isNoneOf` included), so a gate never
 * lets someone through on a question they skipped. Text tests ignore case.
 */
export function gatePasses(
  rules: GateRules,
  answers: ReadonlyMap<string, FormCellValue>
): boolean {
  const passes = (node: GateNode): boolean =>
    node.kind === 'group'
      ? gatePasses(node, answers)
      : conditionPasses(node.test, answers.get(node.column));
  return rules.conjunction === 'and'
    ? rules.conditions.every(passes)
    : rules.conditions.length === 0 || rules.conditions.some(passes);
}

/**
 * An answer with something in it; blank text and empty lists count as none.
 * The one rule for presence: submissions and gates both read it.
 */
export function presentValue(
  value: FormCellValue | undefined
): Exclude<FormCellValue, { type: 'clear' }> | undefined {
  if (!value) return undefined;
  return match(value)
    .with({ type: 'clear' }, () => undefined)
    .with({ type: 'text' }, (text) =>
      text.value.trim().length > 0 ? text : undefined
    )
    .with(
      { type: 'link' },
      { type: 'options' },
      { type: 'entities' },
      { type: 'rows' },
      (list) => (list.value.length > 0 ? list : undefined)
    )
    .with(
      { type: 'number' },
      { type: 'boolean' },
      { type: 'date' },
      (scalar) => scalar
    )
    .exhaustive();
}

function conditionPasses(
  test: GateTest,
  answer: FormCellValue | undefined
): boolean {
  const value = presentValue(answer);
  if (test.kind === 'presence') {
    return test.operator === 'isEmpty' ? !value : !!value;
  }
  if (!value) return false;
  return match(test)
    .with({ kind: 'text' }, ({ operator, value: expected }) => {
      const texts = match(value)
        .with({ type: 'text' }, (text) => [text.value])
        .with({ type: 'link' }, (link) => link.value)
        .with(
          { type: 'number' },
          { type: 'boolean' },
          { type: 'date' },
          { type: 'options' },
          { type: 'entities' },
          { type: 'rows' },
          () => undefined
        )
        .exhaustive();
      if (!texts) return false;
      const needle = expected.toLowerCase();
      const haystacks = texts.map((text) => text.toLowerCase());
      return match(operator)
        .with('is', () => haystacks.some((text) => text === needle))
        .with('isNot', () => !haystacks.some((text) => text === needle))
        .with('contains', () => haystacks.some((text) => text.includes(needle)))
        .with(
          'doesNotContain',
          () => !haystacks.some((text) => text.includes(needle))
        )
        .with('startsWith', () =>
          haystacks.some((text) => text.startsWith(needle))
        )
        .with('endsWith', () => haystacks.some((text) => text.endsWith(needle)))
        .exhaustive();
    })
    .with({ kind: 'number' }, ({ operator, value: expected }) => {
      if (value.type !== 'number') return false;
      const actual = value.value;
      return match(operator)
        .with('is', () => actual === expected)
        .with('isNot', () => actual !== expected)
        .with('greaterThan', () => actual > expected)
        .with('greaterThanOrEqual', () => actual >= expected)
        .with('lessThan', () => actual < expected)
        .with('lessThanOrEqual', () => actual <= expected)
        .exhaustive();
    })
    .with({ kind: 'date' }, ({ operator, value: expected }) => {
      if (value.type !== 'date') return false;
      const actual = Date.parse(value.value);
      const bound = Date.parse(expected);
      if (Number.isNaN(actual) || Number.isNaN(bound)) return false;
      return match(operator)
        .with('before', () => actual < bound)
        .with('after', () => actual > bound)
        .with('onOrBefore', () => actual <= bound)
        .with('onOrAfter', () => actual >= bound)
        .exhaustive();
    })
    .with(
      { kind: 'checkbox' },
      ({ checked }) => value.type === 'boolean' && value.value === checked
    )
    .with({ kind: 'options' }, ({ operator, options }) => {
      if (value.type !== 'options') return false;
      const held = value.value.flatMap((reference) =>
        'id' in reference ? [reference.id] : []
      );
      return setPasses(operator, held, options);
    })
    .with({ kind: 'entities' }, ({ operator, entities }) => {
      const held = match(value)
        .with({ type: 'entities' }, (references) =>
          references.value.map((reference) => reference.entityId)
        )
        .with({ type: 'rows' }, (rows) => rows.value)
        .with(
          { type: 'text' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'date' },
          { type: 'link' },
          { type: 'options' },
          () => undefined
        )
        .exhaustive();
      if (!held) return false;
      return setPasses(operator, held, entities);
    })
    .exhaustive();
}

function setPasses(
  operator: SetOperator,
  held: readonly string[],
  expected: readonly string[]
): boolean {
  const holds = (id: string) => held.includes(id);
  return match(operator)
    .with('isAnyOf', 'hasAny', () => expected.some(holds))
    .with('isNoneOf', 'hasNone', () => !expected.some(holds))
    .with('hasAll', () => expected.every(holds))
    .exhaustive();
}
