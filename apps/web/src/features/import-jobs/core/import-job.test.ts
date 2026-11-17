import type { NotionImportReport } from '@service-cognition/import';
import { describe, expect, it } from 'vitest';
import { importJob, visibleImportRuns } from './import-job';

const NOW = Date.parse('2026-11-06T12:00:00Z');

const WRITING: NotionImportReport = {
  status: 'importing',
  onTeam: false,
  pages: 10,
  dataSources: 2,
  copy: 12,
  tasks: 0,
  skip: 0,
  hand: 0,
  documents: 10,
  databases: 2,
  databaseRows: 40,
  taskRows: 0,
  imported: 3,
  waiting: 7,
  writing: 1,
  waitingOnTeammates: 1,
};

describe('importJob', () => {
  it('follows a Notion run from scanning through writing to done', () => {
    const scanning = importJob(
      {
        source: 'notion',
        status: 'running',
        updated_at: '2026-11-06T11:59:00Z',
        scanned: { pages: 40, dataSources: 3 },
      },
      { report: undefined, slackChannelsImporting: 0 }
    );
    expect(scanning.phase).toEqual({ kind: 'scanning', found: 40 });
    expect(scanning.dismissable).toBe(false);
    expect(scanning.sessionId).toBeUndefined();

    const deciding = importJob(
      {
        source: 'notion',
        status: 'running',
        updated_at: '2026-11-06T11:59:30Z',
        review_session_id: 'session-1',
      },
      {
        report: { ...WRITING, status: 'running', deciding: 5 },
        slackChannelsImporting: 0,
      }
    );
    expect(deciding.phase).toEqual({ kind: 'deciding', remaining: 5 });
    expect(deciding.sessionId).toBe('session-1');

    const writing = importJob(
      {
        source: 'notion',
        status: 'importing',
        updated_at: '2026-11-06T11:59:50Z',
        review_session_id: 'session-1',
      },
      { report: WRITING, slackChannelsImporting: 0 }
    );
    expect(writing.phase).toEqual({ kind: 'importing', done: 3, total: 12 });

    const done = importJob(
      {
        source: 'notion',
        status: 'completed',
        updated_at: '2026-11-06T12:00:00Z',
        review_session_id: 'session-1',
      },
      { report: undefined, slackChannelsImporting: 0 }
    );
    expect(done.phase).toEqual({ kind: 'completed' });
    expect(done.dismissable).toBe(true);
  });

  it('waits for approval once a tracker plan is ready', () => {
    const job = importJob(
      { source: 'linear', status: 'ready', updated_at: '2026-11-06T11:00:00Z' },
      { report: undefined, slackChannelsImporting: 0 }
    );
    expect(job.phase).toEqual({ kind: 'awaitingApproval' });
    expect(job.dismissable).toBe(true);
  });

  it('counts Slack channels being imported after discovery', () => {
    const job = importJob(
      { source: 'slack', status: 'ready', updated_at: '2026-11-01T11:00:00Z' },
      { report: undefined, slackChannelsImporting: 4 }
    );
    expect(job.phase).toEqual({ kind: 'importingChannels', channels: 4 });
    expect(job.dismissable).toBe(false);
  });
});

describe('visibleImportRuns', () => {
  it('keeps moving runs, and settled ones for an hour unless dismissed', () => {
    const visible = visibleImportRuns(
      [
        {
          source: 'jira',
          status: 'failed',
          updated_at: '2026-11-06T11:30:00Z',
        },
        {
          source: 'linear',
          status: 'completed',
          updated_at: '2026-11-06T10:30:00Z',
        },
        {
          source: 'notion',
          status: 'importing',
          updated_at: '2026-11-05T09:00:00Z',
        },
        {
          source: 'slack',
          status: 'dismissed',
          updated_at: '2026-11-06T11:50:00Z',
        },
      ],
      {
        now: NOW,
        dismissed: new Set(['slack:dismissed:2026-11-06T11:50:00Z']),
        slackChannelsImporting: 0,
      }
    );

    expect(visible.map((run) => run.source)).toEqual(['jira', 'notion']);
  });
});
