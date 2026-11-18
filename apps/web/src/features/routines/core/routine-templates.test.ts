import { describe, expect, it, vi } from 'vitest';
import { TEST_CATALOG, testTemplate } from '../tests/catalog';
import { createEmptyDraft, validateRoutineDraft } from './routine-draft';
import {
  availableTemplates,
  featuredTemplates,
  templateChain,
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
const template = testTemplate;

describe('routine templates', () => {
  it('starts code templates with the scheduler’s code', () => {
    const inbox = templateDraft(template('inbox'), base, {
      target,
      codeSteps: true,
    });
    expect(inbox).toMatchObject({
      name: 'Sort my inbox',
      description: 'AI labels new email by topic',
      triggers: [{ kind: 'event', events: ['email.message_received'] }],
      steps: [{ kind: 'code', title: 'Label by topic' }],
    });
  });

  it('falls back to Ask AI, kept in the simple form, where code is unavailable', () => {
    const inbox = templateDraft(template('inbox'), base, {
      target,
      codeSteps: false,
    });
    expect(inbox.steps).toBeUndefined();
    expect(inbox.prompt).toMatch(/Label this email/);
    // The scheduler serves no code where code can't be saved.
    const served = templateDraft(
      { ...template('inbox'), code: undefined },
      base,
      { target, codeSteps: true }
    );
    expect(served.prompt).toMatch(/Label this email/);
  });

  it('schedules briefs on weekdays in the served zone and keeps the update trigger’s condition', () => {
    const brief = templateDraft(template('brief'), base, {
      target,
      codeSteps: true,
    });
    expect(brief.triggers).toMatchObject([
      {
        kind: 'schedule',
        frequency: 'week',
        time: '09:00',
        daysOfWeek: ['2', '3', '4', '5', '6'],
        timezone: 'America/New_York',
      },
    ]);
    expect(validateRoutineDraft(brief, true)).toBeNull();
    const updates = templateDraft(template('updates'), base, {
      target,
      codeSteps: true,
    });
    expect(updates.triggers).toMatchObject([
      { events: ['task.status_changed'], condition: expect.any(String) },
    ]);
    expect(updates.steps).toMatchObject([{ kind: 'code' }]);
  });

  it('says what starts each card and whether AI acts', () => {
    expect(templateChain(template('brief'))).toEqual({
      trigger: 'Weekdays at 9:00 AM',
      action: 'Ask AI',
      actionAi: true,
    });
    expect(templateChain(template('updates')).actionAi).toBe(false);
  });

  it('features four templates on the list, filling in when one is off', () => {
    const keys = (decisions: boolean) =>
      featuredTemplates(TEST_CATALOG, decisions).map(
        (template) => template.key
      );
    expect(keys(true)).toEqual(['inbox', 'triage', 'brief', 'updates']);
    // Without decisions Share updates can't run; Chase stuck tasks fills in.
    expect(keys(false)).toEqual(['inbox', 'triage', 'brief', 'stuck']);
  });

  it('offers templates that need decisions only when decisions are available', () => {
    const keys = (decisions: boolean) =>
      availableTemplates(TEST_CATALOG, decisions).map(
        (template) => template.key
      );
    expect(keys(true)).toContain('updates');
    // Without decisions it would announce every status change as done.
    expect(keys(false)).not.toContain('updates');
    expect(keys(false)).toContain('inbox');
    // A routine only the drafter and suggestions see is never a template.
    expect(keys(true)).not.toContain('invoices');
  });
});
