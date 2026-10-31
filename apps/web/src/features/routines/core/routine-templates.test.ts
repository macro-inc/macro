import { describe, expect, it, vi } from 'vitest';
import { createEmptyDraft, validateRoutineDraft } from './routine-draft';
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

describe('routine templates', () => {
  it('lets AI decide when decisions are available', () => {
    const inbox = templateDraft(template('inbox'), base, {
      decisions: true,
      target,
    });
    expect(inbox).toMatchObject({
      name: 'Sort my inbox',
      triggers: [{ kind: 'event', events: ['email.message_received'] }],
      steps: [{ kind: 'choose', multiple: true }],
    });
    const triage = templateDraft(template('triage'), base, {
      decisions: true,
      target,
    });
    expect(triage.steps?.map((step) => step.kind)).toEqual([
      'choose',
      'choose',
    ]);
  });

  it('falls back to an agent, kept in the simple form, without decisions', () => {
    const inbox = templateDraft(template('inbox'), base, {
      decisions: false,
      target,
    });
    expect(inbox.steps).toBeUndefined();
    expect(inbox.prompt).toMatch(/Label this email/);
  });

  it('schedules briefs on weekdays and leaves only choices to the person', () => {
    const brief = templateDraft(template('brief'), base, {
      decisions: true,
      target,
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
      decisions: true,
      target,
    });
    expect(updates.triggers).toMatchObject([
      { events: ['task.status_changed'], condition: expect.any(String) },
    ]);
    // The channel is the person's to choose.
    expect(validateRoutineDraft(updates, true)).toMatch(/channel/);
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
