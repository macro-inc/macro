import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Schedules } from '@macro-inc/muppet/utilities/schedules';
import type { Base } from '../../context/index.ts';
import { later } from './index.ts';

/** The later area's context: `work`, which the chat and calls areas hand tasks to. */
export const laterContext = (
  { clock }: Pick<Base, 'clock'>,
  schedules: Pick<Schedules, 'set' | 'list'>
) =>
  behavior().decorate({
    work: later({ schedules, clock, id: () => crypto.randomUUID() }),
  });

export type LaterArea = ContextOf<ReturnType<typeof laterContext>>;
