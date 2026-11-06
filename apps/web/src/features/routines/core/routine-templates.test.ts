import { describe, expect, it, vi } from 'vitest';
import { createEmptyDraft, validateRoutineDraft } from './routine-draft';
import type { StepDraft } from './routine-steps';
import {
  availableTemplates,
  featuredTemplates,
  routineTemplates,
  templateDraft,
} from './routine-templates';

vi.mock(
  '@property/identifiers',
  async () => await vi.importActual('@property/identifiers')
);
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

const base = { ...createEmptyDraft('model'), triggers: [], enabled: true };
const target = { kind: 'model' as const, model: 'model' };
const template = (key: string) =>
  routineTemplates.find((template) => template.key === key)!;

const codeStep = (title: string): StepDraft => ({
  id: title,
  kind: 'code',
  title,
  summary: '',
  source: 'export async function main() {}',
  knobs: [],
});

describe('routine templates', () => {
  it('starts code templates with the scheduler’s code', () => {
    const starters = {
      inbox: [codeStep('Label by topic')],
      triage: [codeStep('Set the priority')],
    };
    const inbox = templateDraft(template('inbox'), base, { target, starters });
    expect(inbox).toMatchObject({
      name: 'Sort my inbox',
      triggers: [{ kind: 'event', events: ['email.message_received'] }],
      steps: [{ kind: 'code', title: 'Label by topic' }],
    });
    const triage = templateDraft(template('triage'), base, {
      target,
      starters,
    });
    expect(triage.steps?.map((step) => step.kind)).toEqual(['code']);
  });

  it('falls back to Ask AI, kept in the simple form, where code is unavailable', () => {
    const inbox = templateDraft(template('inbox'), base, {
      target,
      starters: {},
    });
    expect(inbox.steps).toBeUndefined();
    expect(inbox.prompt).toMatch(/Label this email/);
  });

  it('schedules briefs on weekdays and keeps the update trigger’s condition', () => {
    const brief = templateDraft(template('brief'), base, {
      target,
      starters: {},
    });
    expect(brief.triggers).toMatchObject([
      {
        kind: 'schedule',
        frequency: 'week',
        time: '09:00',
        daysOfWeek: ['2', '3', '4', '5', '6'],
      },
    ]);
    expect(validateRoutineDraft(brief, true)).toBeNull();
    const updates = templateDraft(template('updates'), base, {
      target,
      starters: { updates: [codeStep('Post the update')] },
    });
    expect(updates.triggers).toMatchObject([
      { events: ['task.status_changed'], condition: expect.any(String) },
    ]);
    expect(updates.steps).toMatchObject([{ kind: 'code' }]);
  });

  it('features four templates on the list, filling in when one is off', () => {
    const keys = (decisions: boolean) =>
      featuredTemplates(decisions).map((template) => template.key);
    expect(keys(true)).toEqual(['inbox', 'triage', 'brief', 'updates']);
    // Without decisions Share updates can't run; Chase stuck tasks fills in.
    expect(keys(false)).toEqual(['inbox', 'triage', 'brief', 'stuck']);
  });

  it('offers templates that need decisions only when decisions are available', () => {
    const keys = (decisions: boolean) =>
      availableTemplates(decisions).map((template) => template.key);
    expect(keys(true)).toContain('updates');
    // Without decisions it would announce every status change as done.
    expect(keys(false)).not.toContain('updates');
    expect(keys(false)).toContain('inbox');
  });
});
