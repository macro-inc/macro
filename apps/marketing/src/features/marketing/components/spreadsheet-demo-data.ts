export type DemoCell = {
  value: string;
  reference?: { kind: 'person' | 'company'; row: number };
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  format?: 'number' | 'currency' | 'percent';
  decimals?: number;
  fontSize?: number;
};

const header = (value: string) => ({ value, bold: true });

/** Local example only. These are not real customers. */
export const CUSTOMERS: Record<string, DemoCell> = {
  A1: header('Customer'),
  B1: header('Company'),
  C1: header('Email'),
  D1: header('Last active'),
  E1: header('Events'),
  F1: header('Plan'),
  A2: { value: 'Valentina', reference: { kind: 'person', row: 2 } },
  B2: { value: 'Coparse', reference: { kind: 'company', row: 2 } },
  C2: { value: 'valentina@coparse.com' },
  D2: { value: 'Today' },
  E2: { value: '1842', format: 'number', decimals: 0 },
  F2: { value: 'Team' },
  A3: { value: 'Maya', reference: { kind: 'person', row: 3 } },
  B3: { value: 'Lumen', reference: { kind: 'company', row: 3 } },
  C3: { value: 'maya@lumen.example' },
  D3: { value: 'Yesterday' },
  E3: { value: '1204', format: 'number', decimals: 0 },
  F3: { value: 'Team' },
  A4: { value: 'Owen Park', reference: { kind: 'person', row: 4 } },
  B4: { value: 'Fieldnote', reference: { kind: 'company', row: 4 } },
  C4: { value: 'owen@fieldnote.example' },
  D4: { value: 'Sep 20' },
  E4: { value: '986', format: 'number', decimals: 0 },
  F4: { value: 'Pro' },
  A5: { value: 'Priya Shah', reference: { kind: 'person', row: 5 } },
  B5: { value: 'Harbor', reference: { kind: 'company', row: 5 } },
  C5: { value: 'priya@harbor.example' },
  D5: { value: 'Sep 19' },
  E5: { value: '874', format: 'number', decimals: 0 },
  F5: { value: 'Team' },
  A6: { value: 'Leo Martins', reference: { kind: 'person', row: 6 } },
  B6: { value: 'Kindred', reference: { kind: 'company', row: 6 } },
  C6: { value: 'leo@kindred.example' },
  D6: { value: 'Sep 18' },
  E6: { value: '731', format: 'number', decimals: 0 },
  F6: { value: 'Pro' },
  A7: { value: 'Sam Okonkwo', reference: { kind: 'person', row: 7 } },
  B7: { value: 'Relay', reference: { kind: 'company', row: 7 } },
  C7: { value: 'sam@relay.example' },
  D7: { value: 'Sep 17' },
  E7: { value: '655', format: 'number', decimals: 0 },
  F7: { value: 'Team' },
  A8: { value: 'Elena Voss', reference: { kind: 'person', row: 8 } },
  B8: { value: 'Paperplane', reference: { kind: 'company', row: 8 } },
  C8: { value: 'elena@paperplane.example' },
  D8: { value: 'Sep 15' },
  E8: { value: '512', format: 'number', decimals: 0 },
  F8: { value: 'Pro' },
};
