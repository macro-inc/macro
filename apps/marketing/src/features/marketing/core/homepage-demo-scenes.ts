export const HOMEPAGE_DEMO_EVENT = 'macro-homepage-demo-view';
export const HOMEPAGE_DEMO_VIEWS = [
  'Inbox',
  'Chat',
  'Docs',
  'CRM',
  'Tasks',
  'Agents',
] as const;
export type HomepageDemoView = (typeof HOMEPAGE_DEMO_VIEWS)[number];
export function isHomepageDemoView(value: unknown): value is HomepageDemoView {
  return (
    typeof value === 'string' &&
    HOMEPAGE_DEMO_VIEWS.some((view) => view === value)
  );
}
