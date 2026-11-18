// Shared fixed palette for tag options and entity appearance.
// The tag AI tools mirror these values in crates/properties/src/tag_color.rs.
export const COLOR_PALETTE = [
  { key: 'red', name: 'Red', color: '#E5484D' },
  { key: 'tomato', name: 'Tomato', color: '#E54D2E' },
  { key: 'orange', name: 'Orange', color: '#F76B15' },
  { key: 'amber', name: 'Amber', color: '#FFB224' },
  { key: 'yellow', name: 'Yellow', color: '#F5D90A' },
  { key: 'green', name: 'Green', color: '#46A758' },
  { key: 'teal', name: 'Teal', color: '#12A594' },
  { key: 'blue', name: 'Blue', color: '#0091FF' },
  { key: 'indigo', name: 'Indigo', color: '#3E63DD' },
  { key: 'purple', name: 'Purple', color: '#8E4EC6' },
  { key: 'pink', name: 'Pink', color: '#E93D82' },
  { key: 'gray', name: 'Gray', color: '#889096' },
] as const;
