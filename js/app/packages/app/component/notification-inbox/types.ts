export type InboxItemDensity = 'default' | 'compact';
export type InboxItemTone = 'default' | 'muted';

export interface InboxItemStyleProps {
  density?: InboxItemDensity;
  tone?: InboxItemTone;
}
