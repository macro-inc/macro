import type { MobileNavViewId } from './mobile-nav-views';

/** Labels resolve through the feature-gated launcher actions. */
const PAGE_CREATE_LABELS: Partial<Record<MobileNavViewId, string>> = {
  inbox: 'Message',
  mail: 'Email',
  channels: 'Message',
  documents: 'Document',
  tasks: 'Task',
  agents: 'Agent',
};

export function mobilePageCreateLabel(view: MobileNavViewId | undefined) {
  return view ? PAGE_CREATE_LABELS[view] : undefined;
}
