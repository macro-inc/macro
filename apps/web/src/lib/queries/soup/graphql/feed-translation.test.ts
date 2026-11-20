import { FIG_LIBRARY_DESIGNS_ARGS } from '@app/features/block-fig/queries/fig-libraries';
import { expect, it, vi } from 'vitest';
import type { SoupAstItemsQueryArgs } from '../items';
import { QUICK_ACCESS_AGENT_SESSIONS_ARGS } from '../quick-access-agent-sessions';
import { QUICK_ACCESS_INITIATIVES_ARGS } from '../quick-access-initiatives';
import { QUICK_ACCESS_SKILLS_ARGS } from '../quick-access-skills';
import { QUICK_ACCESS_SNIPPETS_ARGS } from '../quick-access-snippets';
import { RECENTLY_VIEWED_ARGS } from '../recently-viewed';
import { SLASH_MENU_PULL_REQUESTS_ARGS } from '../slash-menu-pull-requests';
import { makeGraphqlSoupInput } from './ast';
import { soupRestFallback } from './rest-fallback';

// Only the request constants are under test; keep the feeds' readers out.
vi.mock('@entity', () => ({}));
vi.mock('../items', () => ({ useSoupAstItemsQuery: vi.fn() }));
vi.mock('../bots/bots', () => ({ useBotsQuery: vi.fn() }));
vi.mock('@queries/storage/binary-document', () => ({}));
vi.mock('@service-storage/util/fetchBinary', () => ({}));

const FEEDS: [string, SoupAstItemsQueryArgs][] = [
  ['Quick Access agent sessions', QUICK_ACCESS_AGENT_SESSIONS_ARGS],
  ['Quick Access skills', QUICK_ACCESS_SKILLS_ARGS],
  ['Quick Access snippets', QUICK_ACCESS_SNIPPETS_ARGS],
  ['Quick Access projects', QUICK_ACCESS_INITIATIVES_ARGS],
  ['slash menu pull requests', SLASH_MENU_PULL_REQUESTS_ARGS],
  ['recently viewed', RECENTLY_VIEWED_ARGS],
  ['fig libraries', FIG_LIBRARY_DESIGNS_ARGS],
];

// These feeds moved off the REST soup list; a body GraphQL can't translate
// would quietly read REST again through the fallback.
it.each(FEEDS)('%s reads over GraphQL', (_name, args) => {
  expect(soupRestFallback(args)).toBeUndefined();
  expect(() => makeGraphqlSoupInput(args)).not.toThrow();
});
