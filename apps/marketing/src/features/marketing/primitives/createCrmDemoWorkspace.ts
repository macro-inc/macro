import { createDummyWorkspace } from './createDummyWorkspace';

/** Fictional CRM accounts with the same linked records across website demos. */
export function createCrmDemoWorkspace() {
  const w = createDummyWorkspace('crm');
  // Fictional accounts for the public demo; IDs retain the linked sample records.
  const accountNames: Record<string, string> = {
    northstar: 'Miller & Rowe',
    harbor: 'Juniper Dental',
    ridgeline: 'Eastbank Architecture',
    copperleaf: 'Acorn Accounting',
    orbit: 'Fieldstone Software',
    tidewater: 'Cedar Grove Physio',
    fernway: 'Roamwell Travel',
    meadow: 'Parlor Studio',
    bluebird: 'Westport Freight',
    sable: 'Paperhouse Creative',
    lumen: 'Bookend Retail',
    foxglove: 'Atelier Finch',
    northwind: 'Keystone Mechanical',
    granite: 'Benton Legal',
    relay: 'Replywell',
    pallet: 'Canopy Coffee',
    fieldnote: 'Panelwork Research',
    cedar: 'Studio Morrow',
    fieldwork: 'Commonroom Offices',
    brightline: 'Oaklane Tutoring',
  };
  let sampleData = JSON.stringify(w.data);
  for (const entry of w.data.companies) {
    const name = accountNames[entry.id];
    if (name) sampleData = sampleData.replaceAll(entry.name, name);
  }
  sampleData = sampleData
    .replaceAll('Valentina', 'Ava Chen')
    .replaceAll('valentina@coparse.com', 'ava@parlorstudio.example');
  w.setData(JSON.parse(sampleData));
  w.setData('companies', (entries) =>
    entries.map((entry) => ({
      ...entry,
      owner: entry.owner === 'valentina' ? 'gabriel' : entry.owner,
      domain: `${(accountNames[entry.id] ?? entry.name).toLowerCase().replace(/[^a-z0-9]/g, '')}.example`,
      contacts: entry.contacts.map((contact) => ({
        ...contact,
        email: `${contact.email.split('@')[0]}@${(accountNames[entry.id] ?? entry.name).toLowerCase().replace(/[^a-z0-9]/g, '')}.example`,
      })),
    }))
  );

  return w;
}
