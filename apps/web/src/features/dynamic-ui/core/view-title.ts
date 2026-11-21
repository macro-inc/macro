import type { View, Widget, WidgetType } from '../view';

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
  /** A lone channel thread's line under its channel name: the view's title. */
  caption?: string;
} {
  const [first, ...rest] = view.widgets;
  // A channel thread card is headed by its channel; the view's title takes
  // the card's second line instead of printing above it.
  if (view.title && first?.type === 'channelMessage' && rest.length === 0) {
    return { widgets: view.widgets, caption: view.title };
  }
  if (!view.title || !first || !TITLED_TYPES.has(first.type)) return view;
  const own = 'title' in first ? first.title : undefined;
  if (own === view.title) return { widgets: view.widgets };
  if (!own && rest.length === 0) {
    return { widgets: [{ ...first, title: view.title } as Widget] };
  }
  return view;
}
