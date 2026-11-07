import { Brain, type Composition, judge, tool, z } from '@macro-inc/brain';

// Copy this file to brain.ts in a work branch, then run brain check before merging.
const compose: Composition = (deps) =>
  new Brain(deps, {
    subscriptions: ['document.updated'],
    async onEvent(event, brain) {
      if (event.type === 'other' && event.eventType === 'document.updated') {
        await brain.remember(
          'release-documents',
          `Changed document event ${event.eventId}`
        );
      }
    },
    async relevance(item, services) {
      // Preserve the library's mandatory DM/mention behavior and default first-day
      // policy. Release-specific deterministic rules can be added after feedback.
      if (/\brelease\b/i.test(item.message.text)) {
        return { relevant: true, reason: 'decided', probabilities: {} };
      }
      return judge(item, services);
    },
    tiers: {
      release_review: { concurrency: 1, perRunUsd: 0.5, speaking: true },
    },
    route(item) {
      if (
        item.kind === 'respond' &&
        item.batch.some((entry) => /\brelease\b/i.test(entry.text))
      )
        return 'release_review';
      return item.kind;
    },
    beforeTurn(turn) {
      if (turn.tier === 'release_review')
        return {
          ...turn,
          maxBudgetUsd: 0.4,
          prompt: `${turn.prompt}\nCheck release scope, regressions and rollback readiness.`,
        };
      return turn;
    },
    async afterTurn(turn, outcome) {
      deps.log({
        release_review: turn.tier === 'release_review',
        outcome: outcome.status,
      });
    },
    tools: [
      tool(
        'release_checklist',
        'Get the release readiness checklist',
        { tag: z.string() },
        async ({ tag }) => ({
          content: [
            {
              type: 'text',
              text: `${tag}: confirm scope, run regressions, verify rollout and prepare rollback.`,
            },
          ],
        })
      ),
    ],
    schedules: [
      {
        note: 'release readiness sweep',
        trigger: { type: 'cron', schedule: '0 0 9 * * 1-5', timezone: 'UTC' },
      },
    ],
    async onSchedule(wake, brain) {
      if (wake.schedule?.note !== 'release readiness sweep') return false;
      await brain.remember(
        'release-sweeps',
        'Review readiness on the next relevant conversation.'
      );
    },
    outbound: [
      async (message, next) => next({ ...message, text: message.text.trim() }),
    ],
  });

export default compose;
