import type { Dashboard } from '../core/dashboard';

/** A dashboard as the storage service returns it. */
export function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    id: '0190d2d4-0000-7000-8000-000000000001',
    ownerId: 'macro|agent@example.com',
    title: 'Operations',
    version: 3,
    view: {
      widgets: [
        { type: 'md', id: 'intro', markdown: 'Hello' },
        { type: 'md', markdown: 'No id' },
      ],
    },
    accessLevel: 'view',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
    ...overrides,
  };
}
