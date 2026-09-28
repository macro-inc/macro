import {
  SAMPLE_FILES,
  SAMPLE_PATCH,
} from '@app/components/diff-view/debug/fixtures';
import type { SessionChanges } from '../core/changeset';

export function gallerySummary(): SessionChanges {
  return {
    capturing: false,
    attempt: {
      startedAt: '2026-09-15T00:00:00Z',
      finishedAt: '2026-09-15T00:00:02Z',
      outcome: 'captured',
    },
    changeset: {
      id: 'gallery-changeset',
      repository: 'https://github.com/macro-inc/macro',
      base: { name: 'main' },
      head: { name: 'agent/unread-archived-sessions' },
      files: SAMPLE_FILES,
      additions: SAMPLE_FILES.reduce((sum, file) => sum + file.additions, 0),
      deletions: SAMPLE_FILES.reduce((sum, file) => sum + file.deletions, 0),
      patchBytes: SAMPLE_PATCH.length,
      truncated: false,
      capturedAt: '2026-09-15T00:00:02Z',
    },
  };
}
