import type { ComponentProps } from 'solid-js';
import { RecordTabs } from './components/record-tabs';
import { CrmProvider } from './context/crm-context';
import { CONTACT_SECTIONS, type ContactSection } from './core/record';
import { createAppCrmContext } from './crm-adapter';
import { Contact as View } from './views/contact-detail';

export type { ContactSection } from './core/record';

export function Contact(props: ComponentProps<typeof View>) {
  return (
    <CrmProvider value={createAppCrmContext()}>
      <View {...props} />
    </CrmProvider>
  );
}

/** The contact's section tabs, for a host's top bar. */
export function ContactTabs(props: {
  value: ContactSection;
  onChange: (section: ContactSection) => void;
  compact?: boolean;
}) {
  return <RecordTabs sections={CONTACT_SECTIONS} {...props} />;
}
