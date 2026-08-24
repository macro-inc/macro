export const AGENT_GRID_COLUMNS = [
  {
    id: 'status',
    label: 'Status',
    width: 'var(--agent-col-status, 8rem)',
  },
  {
    id: 'model',
    label: 'Model',
    width: 'var(--agent-col-model, 9rem)',
  },
  {
    id: 'harness',
    label: 'Harness',
    width: 'var(--agent-col-harness, 8rem)',
  },
] as const;

export type AgentGridColumn = (typeof AGENT_GRID_COLUMNS)[number];

const COLUMN_WIDTHS = AGENT_GRID_COLUMNS.map((c) => c.width).join(' ');
const COLUMN_AREAS = AGENT_GRID_COLUMNS.map((c) => c.id).join(' ');

/** Grid template for wide containers. */
export const AGENT_GRID_TEMPLATE_COLUMNS_WIDE = `1rem minmax(0, 100%) ${COLUMN_WIDTHS} var(--agent-col-timestamp, 5rem)`;

/** Wide template without the leading indicator (checkbox) column. */
export const AGENT_GRID_TEMPLATE_COLUMNS_WIDE_NO_INDICATOR = `minmax(0, 100%) ${COLUMN_WIDTHS} var(--agent-col-timestamp, 5rem)`;

/** Grid template areas for wide containers. */
export const AGENT_GRID_TEMPLATE_AREAS_WIDE = `"indicator content ${COLUMN_AREAS} timestamp"`;

/** Wide template areas without the leading indicator (checkbox) column. */
export const AGENT_GRID_TEMPLATE_AREAS_WIDE_NO_INDICATOR = `"content ${COLUMN_AREAS} timestamp"`;
