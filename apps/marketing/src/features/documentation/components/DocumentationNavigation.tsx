import { type DocNavigation, navigation, pages } from 'virtual:macro-docs';
import GitHub from '@icon/mcp-github.svg';
import Mention from '@icon/system/regular/at.svg';
import Building from '@icon/system/regular/building-office.svg';
import Calendar from '@icon/system/regular/calendar.svg';
import Routine from '@icon/system/regular/clock-clockwise.svg';
import Database from '@icon/system/regular/database.svg';
import Email from '@icon/system/regular/envelope.svg';
import Document from '@icon/system/regular/file.svg';
import Folder from '@icon/system/regular/folder-simple.svg';
import Review from '@icon/system/regular/git-pull-request.svg';
import Home from '@icon/system/regular/house.svg';
import Event from '@icon/system/regular/lightning.svg';
import Link from '@icon/system/regular/link.svg';
import Task from '@icon/system/regular/list-checks.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Call from '@icon/system/regular/phone-call.svg';
import Canvas from '@icon/system/regular/shapes.svg';
import Agent from '@icon/system/regular/sparkle.svg';
import Tag from '@icon/system/regular/tag.svg';
import Close from '@icon/system/regular/x.svg';
import Spreadsheet from '@icon/wide-spreadsheet.svg';
import Skill from '@phosphor/blueprint.svg';
import Snippet from '@phosphor/brackets-curly.svg';
import Channel from '@phosphor/chats-circle.svg';
import Block from '@phosphor/cube.svg';
import Graph from '@phosphor/graph.svg';
import Heart from '@phosphor/heart.svg';
import Permission from '@phosphor/lock.svg';
import Setup from '@phosphor/rocket-launch.svg';
import Property from '@phosphor/sliders-horizontal.svg';
import Stack from '@phosphor/stack.svg';
import { isMac } from '@solid-primitives/platform';
import {
  type Component,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ClickUp from '../../../assets/icons/logo-clickup.svg';
import Linear from '../../../assets/icons/logo-linear.svg';
import Notion from '../../../assets/icons/logo-notion.svg';
import Slack from '../../../assets/icons/logo-slack.svg';
import Superhuman from '../../../assets/icons/logo-superhuman.svg';
import {
  FEATURE_PAGES,
  featureHrefForGuide,
} from '../../marketing/core/navigation';
import { createPageSearch } from '../core/page-search';

const coreFeaturePaths = new Set([
  '/email',
  '/tasks',
  '/channels',
  '/documents',
  '/calls',
  '/crm',
  '/agents',
]);
const extraFeaturePaths = new Set([
  '/canvas',
  '/snippets',
  '/booking-links',
  '/routines',
  '/skills',
]);
const featureGroups = [
  {
    title: 'Top features',
    pages: FEATURE_PAGES.filter((page) => coreFeaturePaths.has(page.href)),
  },
  {
    title: 'More features',
    pages: FEATURE_PAGES.filter(
      (page) =>
        !coreFeaturePaths.has(page.href) && !extraFeaturePaths.has(page.href)
    ),
  },
  {
    title: 'Even more features',
    pages: FEATURE_PAGES.filter((page) => extraFeaturePaths.has(page.href)),
  },
];

const blockIcons: Record<
  string,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>> | undefined
> = {
  '/': Home,
  '/replace-apps': Stack,
  '/docs/concepts/blocks': Block,
  '/docs/concepts/mentions': Mention,
  '/docs/product/tagging': Tag,
  '/docs/concepts/event-system': Event,
  '/docs/product/search': Search,
  '/docs/concepts/properties': Property,
  '/docs/permissions': Permission,
  '/docs/product/sharing': Graph,
  '/docs/switch-to-macro': Setup,
  '/posts/linear-alternative': Linear,
  '/posts/notion-alternative': Notion,
  '/posts/superhuman-alternative': Superhuman,
  '/posts/slack-alternative': Slack,
  '/posts/clickup-alternative': ClickUp,
  '/docs/product/email': Email,
  '/docs/product/tasks': Task,
  '/docs/product/channels': Channel,
  '/docs/product/docs': Document,
  '/docs/product/calls': Call,
  '/docs/product/crm': Building,
  '/docs/product/agents': Agent,
  '/docs/integrations/github': GitHub,
  '/docs/product/canvas': Canvas,
  '/docs/product/snippets': Snippet,
  '/docs/product/calendar': Calendar,
  '/docs/product/folders': Folder,
  '/docs/product/booking-links': Link,
  '/docs/product/drive': Folder,
  '/docs/product/spreadsheets': Spreadsheet,
  '/docs/product/databases': Database,
  '/docs/product/reviews': Review,
  '/docs/product/routines': Routine,
  '/docs/product/skills': Skill,
};

function NavigationLabel(props: { href: string; title: string }) {
  return (
    <span class="doc-nav-label">
      <Show when={blockIcons[props.href]}>
        {(icon) => (
          <span class="doc-nav-icon-slot">
            <Dynamic
              component={icon()}
              class="doc-nav-icon"
              aria-hidden="true"
            />
          </span>
        )}
      </Show>
      <span>{props.title}</span>
    </span>
  );
}

function withoutFeatureGuides(items: DocNavigation[]): DocNavigation[] {
  return items.flatMap((entry): DocNavigation[] => {
    if (typeof entry === 'string')
      return ['index', 'getting-started', 'switch-to-macro', 'apps'].includes(
        entry
      ) || featureHrefForGuide(`/docs/${entry}`)
        ? []
        : [entry];
    const children = withoutFeatureGuides(entry.pages);
    return children.length
      ? [
          {
            ...entry,
            group:
              entry.group === 'Features'
                ? 'Workspace basics'
                : entry.group === 'Key Concepts'
                  ? 'Main benefits'
                  : entry.group,
            pages: children,
          },
        ]
      : [];
  });
}
const guideNavigation = withoutFeatureGuides(navigation);
const mainBenefits = guideNavigation.filter(
  (entry) => typeof entry !== 'string' && entry.group === 'Main benefits'
);
const agentGuides = guideNavigation.filter(
  (entry) => typeof entry !== 'string' && entry.group === 'Agents'
);
const moreLinks = [
  { href: '/pricing', title: 'Pricing' },
  { href: '/docs/account/teams', title: 'Teams & Admin' },
  { href: '/docs/account/billing', title: 'Billing & Plans' },
  { href: '/docs/security', title: 'Security' },
  { href: '/docs/support', title: 'Get support' },
  { href: '/docs/keyboard-shortcuts', title: 'Keyboard shortcuts' },
  { href: '/docs/changelog/introduction', title: 'Changelog' },
  { href: '/posts', title: 'Blog' },
  { href: '/partners', title: 'Partners' },
  { href: '/jobs', title: 'Jobs' },
  { href: '/download', title: 'Download Macro' },
  { href: '/legal', title: 'Legal' },
];

export function DocumentationNavigation(props: { currentPath: string }) {
  const [query, setQuery] = createSignal('');
  const [searchActive, setSearchActive] = createSignal(false);
  const [searchPages] = createResource(
    searchActive,
    async () => (await import('virtual:macro-search')).searchPages
  );
  const searchSite = createMemo(() =>
    createPageSearch(
      searchPages.loading || searchPages.error ? [] : (searchPages() ?? [])
    )
  );
  const results = createMemo(() => searchSite()(query()));
  let searchInput: HTMLInputElement | undefined;
  let resultList: HTMLDivElement | undefined;
  const clearSearch = () => {
    setQuery('');
    searchInput?.focus();
  };
  const navigateResults = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && query()) {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
      return;
    }
    const links = Array.from(
      resultList?.querySelectorAll<HTMLAnchorElement>('a') ?? []
    );
    if (event.key === 'Enter' && event.target === searchInput && links.length) {
      event.preventDefault();
      links[0].click();
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (!links.length) return;
    event.preventDefault();
    const index =
      document.activeElement instanceof HTMLAnchorElement
        ? links.indexOf(document.activeElement)
        : -1;
    const next =
      event.key === 'ArrowDown'
        ? index + 1
        : index < 0
          ? links.length - 1
          : index - 1;
    if (next < 0) searchInput?.focus();
    else links[Math.min(next, links.length - 1)].focus();
  };
  function Entries(entries: { items: DocNavigation[] }) {
    return (
      <For each={entries.items}>
        {(entry) => {
          if (typeof entry === 'string') {
            const page = pages.find((p) => p.slug === entry);
            return (
              <Show when={page}>
                {(page) => (
                  <a
                    href={page().href}
                    aria-current={
                      props.currentPath.replace(/\/$/, '') === page().href
                        ? 'page'
                        : undefined
                    }
                  >
                    <NavigationLabel href={page().href} title={page().title} />
                  </a>
                )}
              </Show>
            );
          }
          if (entry.group === 'Changelog') {
            return <Entries items={['changelog/introduction']} />;
          }
          return (
            <section class="doc-nav-group" aria-label={entry.group}>
              <h2 class="doc-nav-heading">{entry.group}</h2>
              <Show when={entry.group === 'Main benefits'}>
                <a
                  href="/replace-apps"
                  aria-current={
                    props.currentPath === '/replace-apps' ? 'page' : undefined
                  }
                >
                  <NavigationLabel
                    href="/replace-apps"
                    title="Replace 27+ apps"
                  />
                </a>
              </Show>
              <Entries items={entry.pages} />
            </section>
          );
        }}
      </For>
    );
  }
  return (
    <>
      <div class="doc-nav-top">
        <div class="doc-nav-search">
          <span
            class="doc-nav-search-icon doc-nav-icon-slot"
            aria-hidden="true"
          >
            <Search class="doc-nav-icon" />
          </span>
          <input
            ref={searchInput}
            type="search"
            aria-label="Search pages"
            aria-controls="site-search-results"
            autocomplete="off"
            placeholder={`Search pages ${isMac ? '⌘F' : 'Ctrl+F'}`}
            value={query()}
            onFocus={() => setSearchActive(true)}
            onInput={(event) => {
              setSearchActive(true);
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={navigateResults}
          />
          <Show when={query()}>
            <button
              type="button"
              class="doc-nav-search-clear"
              aria-label="Clear search"
              onClick={clearSearch}
            >
              <Close aria-hidden="true" />
            </button>
          </Show>
        </div>
      </div>
      <Show
        when={query().trim()}
        fallback={
          <>
            <a
              href="/"
              aria-current={props.currentPath === '/' ? 'page' : undefined}
            >
              <span class="doc-nav-label">
                <span class="doc-nav-icon-slot">
                  <Home class="doc-nav-icon" aria-hidden="true" />
                </span>
                <span>Home</span>
              </span>
            </a>
            <a
              href="/wall-of-love"
              aria-current={
                props.currentPath === '/wall-of-love' ? 'page' : undefined
              }
            >
              <span class="doc-nav-label">
                <span class="doc-nav-icon-slot">
                  <Heart class="doc-nav-icon" aria-hidden="true" />
                </span>
                <span>Wall of love</span>
              </span>
            </a>
            <For each={featureGroups}>
              {(group) => (
                <>
                  <Show when={group.title === 'More features'}>
                    <Entries items={mainBenefits} />
                  </Show>
                  <section class="doc-nav-group" aria-label={group.title}>
                    <h2 class="doc-nav-heading">{group.title}</h2>
                    <div class="doc-nav-products">
                      <For each={group.pages}>
                        {(page) => (
                          <a
                            href={page.href}
                            aria-current={
                              (featureHrefForGuide(
                                props.currentPath.replace(/\/$/, '')
                              ) ?? props.currentPath.replace(/\/$/, '')) ===
                              page.href
                                ? 'page'
                                : undefined
                            }
                          >
                            <NavigationLabel
                              href={page.guide}
                              title={page.label}
                            />
                          </a>
                        )}
                      </For>
                    </div>
                  </section>
                </>
              )}
            </For>
            <section class="doc-nav-group" aria-label="Switch to Macro">
              <h2 class="doc-nav-heading">Switch to Macro</h2>
              <a
                href="/docs/switch-to-macro"
                aria-current={
                  props.currentPath === '/docs/switch-to-macro'
                    ? 'page'
                    : undefined
                }
              >
                <NavigationLabel
                  href="/docs/switch-to-macro"
                  title="Switching guide"
                />
              </a>
              <a
                href="/posts/linear-alternative"
                aria-current={
                  props.currentPath === '/posts/linear-alternative'
                    ? 'page'
                    : undefined
                }
              >
                <NavigationLabel
                  href="/posts/linear-alternative"
                  title="Versus Linear"
                />
              </a>
              <a
                href="/posts/notion-alternative"
                aria-current={
                  props.currentPath === '/posts/notion-alternative'
                    ? 'page'
                    : undefined
                }
              >
                <NavigationLabel
                  href="/posts/notion-alternative"
                  title="Versus Notion"
                />
              </a>
              <a
                href="/posts/superhuman-alternative"
                aria-current={
                  props.currentPath === '/posts/superhuman-alternative'
                    ? 'page'
                    : undefined
                }
              >
                <NavigationLabel
                  href="/posts/superhuman-alternative"
                  title="Versus Superhuman"
                />
              </a>
              <a
                href="/posts/slack-alternative"
                aria-current={
                  props.currentPath === '/posts/slack-alternative'
                    ? 'page'
                    : undefined
                }
              >
                <NavigationLabel
                  href="/posts/slack-alternative"
                  title="Versus Slack"
                />
              </a>
              <a
                href="/posts/clickup-alternative"
                aria-current={
                  props.currentPath === '/posts/clickup-alternative'
                    ? 'page'
                    : undefined
                }
              >
                <NavigationLabel
                  href="/posts/clickup-alternative"
                  title="Versus ClickUp"
                />
              </a>
            </section>
            <Entries items={agentGuides} />
            <section class="doc-nav-group" aria-label="More stuff">
              <h2 class="doc-nav-heading">More stuff</h2>
              <For each={moreLinks}>
                {(page) => (
                  <a
                    href={page.href}
                    aria-current={
                      props.currentPath.replace(/\/$/, '') === page.href
                        ? 'page'
                        : undefined
                    }
                  >
                    {page.title}
                  </a>
                )}
              </For>
            </section>
          </>
        }
      >
        <div
          id="site-search-results"
          ref={resultList}
          class="doc-search-results"
          onKeyDown={navigateResults}
        >
          <span class="sr-only" role="status">
            {results().length} pages found
          </span>
          <For each={results()}>
            {(page) => (
              <a
                class="doc-search-result"
                href={page.href}
                aria-current={
                  props.currentPath.replace(/\/$/, '') === page.href
                    ? 'page'
                    : undefined
                }
              >
                <span class="doc-nav-icon-slot">
                  <Dynamic
                    component={
                      blockIcons[page.iconHref ?? page.href] ?? Document
                    }
                    class="doc-nav-icon"
                    aria-hidden="true"
                  />
                </span>
                <span class="doc-search-result-copy">
                  <span>{page.title}</span>
                  <small>{page.context}</small>
                </span>
              </a>
            )}
          </For>
          <Show when={results().length === 0}>
            <p class="doc-nav-empty">
              {searchPages.loading
                ? 'Loading search…'
                : searchPages.error
                  ? 'Search could not load. Refresh to try again.'
                  : 'No pages found. Try a feature, topic, or product name.'}
            </p>
          </Show>
        </div>
      </Show>
    </>
  );
}
