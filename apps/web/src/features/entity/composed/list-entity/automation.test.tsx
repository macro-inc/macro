import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { AutomationEntity, RoutineStatus } from '../../types/entity';
import { AutomationWideContent } from './automation';

vi.mock('../../entity', () => ({
  Entity: {
    Title: (props: { entity: { name: string } }) => <>{props.entity.name}</>,
  },
}));
vi.mock('../../utils/timestamp', () => ({
  formatDateAndTime: (value: string) => value,
}));

function routine(name: string, status: RoutineStatus): AutomationEntity {
  return {
    id: name,
    type: 'automation',
    name,
    ownerId: 'macro|owner@example.com',
    cron: '0 0 9 * * 2',
    status,
  };
}

describe('AutomationWideContent', () => {
  it.each<[RoutineStatus, string]>([
    [{ kind: 'running' }, 'SummaryRunning'],
    [{ kind: 'paused' }, 'SummaryPaused'],
    [
      { kind: 'scheduled', nextRunAt: '2026-09-29T09:00:00Z' },
      'SummaryNext run 2026-09-29T09:00:00Z',
    ],
    [{ kind: 'unscheduled' }, 'Summary'],
  ])('labels a %j routine as %j', (status, text) => {
    const { container } = render(() => (
      <AutomationWideContent entity={routine('Summary', status)} />
    ));
    expect(container.textContent).toBe(text);
  });

  it('mutes the title of a paused routine only', () => {
    render(() => (
      <>
        <AutomationWideContent
          entity={routine('Paused routine', { kind: 'paused' })}
        />
        <AutomationWideContent
          entity={routine('Active routine', {
            kind: 'scheduled',
            nextRunAt: '2026-09-29T09:00:00Z',
          })}
        />
      </>
    ));
    expect(
      screen.getByText('Paused routine').classList.contains('text-ink-muted')
    ).toBe(true);
    expect(
      screen.getByText('Active routine').classList.contains('text-ink-muted')
    ).toBe(false);
  });
});
