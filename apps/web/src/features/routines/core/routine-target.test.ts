import { describe, expect, it } from 'vitest';
import {
  type RoutineTarget,
  routineTargetSchema,
  routineTargetsEqual,
} from './routine-target';

const agentId = '0195a096-3d24-7000-8000-000000000001';

describe('routine targets', () => {
  it.each<RoutineTarget>([
    { kind: 'model', model: 'retired-provider/custom-model' },
    { kind: 'agent', agentId },
    { kind: 'agent', agentId, modelOverride: 'runtime/new-model' },
  ])('retains selections without consulting a catalog: %j', (target) => {
    expect(routineTargetSchema.parse(target)).toEqual(target);
    expect(routineTargetsEqual(target, { ...target })).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { kind: 'other', model: 'model' },
    { kind: 'model', model: '' },
    { kind: 'model', model: '  ' },
    { kind: 'model', model: 42 },
    { kind: 'model', model: 'model', agentId },
    { kind: 'agent', agentId: 'not-a-uuid' },
    { kind: 'agent', agentId, modelOverride: '' },
    { kind: 'agent', agentId, modelOverride: null },
    { kind: 'agent', agentId, model: 'ambiguous-field' },
  ])('rejects malformed targets: %j', (target) => {
    expect(routineTargetSchema.safeParse(target).success).toBe(false);
  });

  it('distinguishes model IDs, agents, and default versus explicit models', () => {
    const agent = { kind: 'agent' as const, agentId };
    expect(
      routineTargetsEqual(agent, { ...agent, modelOverride: 'model' })
    ).toBe(false);
    expect(
      routineTargetsEqual(agent, {
        ...agent,
        agentId: '0195a096-3d24-7000-8000-000000000002',
      })
    ).toBe(false);
    expect(routineTargetsEqual(agent, { kind: 'model', model: 'model' })).toBe(
      false
    );
    expect(
      routineTargetsEqual(
        { kind: 'model', model: 'a' },
        { kind: 'model', model: 'b' }
      )
    ).toBe(false);
  });
});
