// The AI tools mirror this palette in
// crates/properties/src/inbound/toolset/tag_color.rs (TagColor::hex). Keep the
// two in sync when adding, removing, recoloring, or reordering a tag color.
export const TAG_COLORS = [
  '#E5484D', // Red
  '#E54D2E', // Tomato
  '#F76B15', // Orange
  '#FFB224', // Amber
  '#F5D90A', // Yellow
  '#46A758', // Green
  '#12A594', // Teal
  '#0091FF', // Blue
  '#3E63DD', // Indigo
  '#8E4EC6', // Purple
  '#E93D82', // Pink
  '#889096', // Gray
] as const;

export const DEFAULT_TAG_COLOR: string = TAG_COLORS[11];
