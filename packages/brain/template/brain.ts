import { Brain, type Composition } from '@macro-inc/brain';
import { triage } from './brain/triage.ts';

// Start with every visible event; learn from outcomes before narrowing.
const compose: Composition = (deps) =>
  new Brain(deps, {
    subscriptions: [],
    triage,
    learning: { wakesPerTune: 100, triageModel: 'claude-haiku-4-5' },
    schedules: [
      {
        note: 'tune',
        trigger: { type: 'cron', schedule: '0 0 4 * * *', timezone: 'UTC' },
      },
    ],
    async onSchedule(trigger, brain) {
      if (trigger.schedule?.note !== 'tune') return false;
      await brain.tune();
    },
  });
export default compose;
