/**
 * Permission rules: which operations a program may call, decided from a
 * rules file and the operation table (contracts D1, D4).
 */
import { match } from 'ts-pattern';
import { z } from 'zod';
import { ACTION, type OperationsFile, operationsByName } from './operations';

const DECISION = z.enum(['allow', 'block']);

export type Decision = z.infer<typeof DECISION>;

export const RulesFile = z.object({
  default: DECISION,
  rules: z.array(z.object({ match: z.string(), decision: DECISION })),
});

export type RulesFile = z.infer<typeof RulesFile>;

type OperationInfo = { group: string; action: string };

/**
 * What a selector matches: an exact operation name, a whole group
 * (`documents.*`), every operation with an action (`@destroy`), or one action
 * within a group (`documents@update`).
 */
type Selector =
  | { kind: 'exact'; name: string }
  | { kind: 'group'; group: string }
  | { kind: 'action'; group: string | undefined; action: string };

function parseSelector(
  text: string,
  operations: ReadonlyMap<string, OperationInfo>
): Selector {
  const groups = new Set([...operations.values()].map((info) => info.group));

  const at = text.indexOf('@');
  if (at >= 0) {
    const group = text.slice(0, at);
    const action = ACTION.safeParse(text.slice(at + 1));
    if (!action.success)
      throw new Error(
        `rule "${text}": the action after @ must be one of ${ACTION.options.join(', ')}`
      );
    if (group && !groups.has(group))
      throw new Error(`rule "${text}": no operation is in group "${group}"`);
    return { kind: 'action', group: group || undefined, action: action.data };
  }

  if (text.endsWith('.*')) {
    const group = text.slice(0, -2);
    if (!groups.has(group))
      throw new Error(`rule "${text}": no operation is in group "${group}"`);
    return { kind: 'group', group };
  }

  if (!operations.has(text))
    throw new Error(`rule "${text}": no operation has this name`);
  return { kind: 'exact', name: text };
}

function matches(selector: Selector, name: string, info: OperationInfo) {
  return match(selector)
    .with({ kind: 'exact' }, (exact) => exact.name === name)
    .with({ kind: 'group' }, (group) => group.group === info.group)
    .with(
      { kind: 'action' },
      (action) =>
        action.action === info.action &&
        (action.group === undefined || action.group === info.group)
    )
    .exhaustive();
}

/**
 * Decides operations by rules. Selectors are checked when the policy is
 * built, so a typo in the rules file fails startup instead of silently
 * falling through to the default.
 */
export class Policy {
  private readonly operations: ReadonlyMap<string, OperationInfo>;
  private readonly rules: readonly { selector: Selector; decision: Decision }[];
  private readonly fallback: Decision;

  constructor(rules: RulesFile, operations: OperationsFile) {
    this.operations = new Map(
      [...operationsByName(operations).values()].map((operation) => [
        operation.name,
        { group: operation.group, action: operation.action },
      ])
    );
    this.rules = rules.rules.map((rule) => ({
      selector: parseSelector(rule.match, this.operations),
      decision: rule.decision,
    }));
    this.fallback = rules.default;
  }

  /** The last matching rule wins; an unknown operation is always blocked. */
  decide(name: string): Decision {
    const info = this.operations.get(name);
    if (!info) return 'block';

    let decision = this.fallback;
    for (const rule of this.rules) {
      if (matches(rule.selector, name, info)) decision = rule.decision;
    }
    return decision;
  }
}
