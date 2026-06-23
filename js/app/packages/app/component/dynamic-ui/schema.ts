/**
 * Dynamic UI widget schema.
 *
 * This is the single source of truth for the `compose_view` contract: the
 * discriminated union below is both (a) what the renderer consumes and (b) the
 * shape that AI will eventually emit as tool-call arguments. Keep it serialisable
 * — every field must survive a JSON round-trip (no functions, no class instances).
 *
 * A `View` is a flex container of widgets. Layout is order-driven; nesting is
 * achieved with the `container` widget.
 *
 * The schemas below are the runtime source of truth; every exported type is
 * derived from its schema with `z.infer`.
 */

import type { Query } from '@app/component/next-soup/filters/filter-store/types';
import { EntityType } from '@core/types';
import { z } from 'zod';

/** A reference to a workspace entity (document, channel, task, PR, person, …). */
export const EntityRefSchema = z.object({
  id: z.string(),
  type: z.enum(Object.values(EntityType) as [EntityType, ...EntityType[]]),
});
export type EntityRef = z.infer<typeof EntityRefSchema>;

/**
 * A SoupView filter query. This lives in (and is owned by) the next-soup filter
 * store; re-deriving its full shape in zod is out of scope, so we validate it as
 * an opaque pass-through while keeping the precise `Query` type.
 */
export const QuerySchema = z.custom<Query>();

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

/** Static markdown — the narrative glue between data widgets. Supports the full
 *  markdown feature set (headings, lists, bold/italic, links, blockquotes, …). */
export const MdWidgetSchema = z.object({
  type: z.literal('md'),
  markdown: z.string(),
});
export type MdWidget = z.infer<typeof MdWidgetSchema>;

/** A single labelled metric, optionally with a trend delta. */
export const StatWidgetSchema = z.object({
  type: z.literal('stat'),
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  /** e.g. "PRs", "%", "ms" — rendered next to the value. */
  unit: z.string().optional(),
  /** Change vs a prior period. */
  delta: z
    .object({
      value: z.number(),
      direction: z.enum(['up', 'down', 'neutral']),
      /** e.g. "vs last week". */
      label: z.string().optional(),
    })
    .optional(),
});
export type StatWidget = z.infer<typeof StatWidgetSchema>;

/** A chronological sequence of events. Great for "what happened" answers. */
export const TimelineWidgetSchema = z.object({
  type: z.literal('timeline'),
  title: z.string().optional(),
  events: z.array(
    z.object({
      /** Human-readable timestamp, e.g. "9:32am" or "Yesterday". */
      time: z.string(),
      title: z.string(),
      description: z.string().optional(),
      /** Links the event to a workspace entity. */
      entity: EntityRefSchema.optional(),
      /** true = upcoming/future event, rendered gray; omitted/false = past, rendered accent. */
      future: z.boolean().optional(),
    })
  ),
});
export type TimelineWidget = z.infer<typeof TimelineWidgetSchema>;

/**
 * A list of workspace items. Two input modes:
 *  - `query`: hand the list a filter and it fetches matching items itself.
 *  - `items`: pre-populate with a fixed set of entity refs.
 * Reuses the existing SoupView engine (filtering, grouping, virtualization).
 */
export const ListWidgetSchema = z.object({
  type: z.literal('list'),
  title: z.string().optional(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('query'), query: QuerySchema }),
    z.object({ kind: z.literal('items'), entities: z.array(EntityRefSchema) }),
  ]),
  /** Group rows by a facet. Maps onto SoupView's GroupByField. */
  groupBy: z.enum(['date', 'entity_type', 'project']).optional(),
  /** Cap the number of rows shown. */
  limit: z.number().optional(),
});
export type ListWidget = z.infer<typeof ListWidgetSchema>;

/** A rich preview card for a single entity (task, md doc, …) — the same rich
 *  body shown on hover, rendered inline. */
export const CardWidgetSchema = z.object({
  type: z.literal('card'),
  entity: EntityRefSchema,
});
export type CardWidget = z.infer<typeof CardWidgetSchema>;

/** Render a single channel message with surrounding context. */
export const ChannelMessageWidgetSchema = z.object({
  type: z.literal('channelMessage'),
  /** The channel the message belongs to. */
  channelId: z.string(),
  /** The message to render. */
  messageId: z.string(),
});
export type ChannelMessageWidget = z.infer<typeof ChannelMessageWidgetSchema>;

/**
 * A nestable flex container. This is what makes real dashboards composable.
 *
 * `ContainerWidget` and `Widget` are mutually recursive, so their types are
 * declared explicitly (TS can't infer across the cycle) and the schemas are
 * annotated to match. A getter defers `WidgetSchema` resolution until parse time.
 */
export type ContainerWidget = {
  type: 'container';
  direction?: 'row' | 'col';
  /** Tailwind-ish gap step, 0–8. Defaults to 3. */
  gap?: number;
  wrap?: boolean;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  title?: string;
  children: Widget[];
};

export const ContainerWidgetSchema: z.ZodType<ContainerWidget> = z.object({
  type: z.literal('container'),
  direction: z.enum(['row', 'col']).optional(),
  gap: z.number().optional(),
  wrap: z.boolean().optional(),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
  justify: z.enum(['start', 'center', 'end', 'between']).optional(),
  title: z.string().optional(),
  get children() {
    return z.array(WidgetSchema);
  },
});

export type Widget =
  | MdWidget
  | StatWidget
  | TimelineWidget
  | ListWidget
  | CardWidget
  | ChannelMessageWidget
  | ContainerWidget;

export const WidgetSchema: z.ZodType<Widget> = z.union([
  MdWidgetSchema,
  StatWidgetSchema,
  TimelineWidgetSchema,
  ListWidgetSchema,
  CardWidgetSchema,
  ChannelMessageWidgetSchema,
  ContainerWidgetSchema,
]);

export type WidgetType = Widget['type'];

/** Narrow a `Widget` to a specific variant by its `type`. */
export type WidgetOf<T extends WidgetType> = Extract<Widget, { type: T }>;

/** A top-level composed view: a flex column of widgets. */
export const ViewSchema = z.object({
  title: z.string().optional(),
  widgets: z.array(WidgetSchema),
});
export type View = z.infer<typeof ViewSchema>;
