import type { View, Widget, WidgetType } from '../schema';

/** Widgets that are cards with a header of their own. */
const TITLED_TYPES: ReadonlySet<WidgetType> = new Set<WidgetType>([
  'list',
  'events',
  'cards',
  'timeline',
  'tags',
]);

/**
 * The view's title and widgets as they should show: a card already says
 * what it is in its own header, so a view whose title is its one card's
 * title - or names a lone card that has none - hands the title to the card
 * instead of printing it twice.
 */
export function titledWidgets(view: View): {
  title?: string;
  widgets: Widget[];
} {
  const [first, ...rest] = view.widgets;
  if (!view.title || !first || !TITLED_TYPES.has(first.type)) return view;
  const own = 'title' in first ? first.title : undefined;
  if (own === view.title) return { widgets: view.widgets };
  if (!own && rest.length === 0) {
    return { widgets: [{ ...first, title: view.title } as Widget] };
  }
  return view;
}
