export type DemoCell = {
  value: string;
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
  A2: { value: 'Dana Whitfield' },
  B2: { value: 'Northwind' },
  C2: { value: 'dana@northwind.example' },
  D2: { value: 'Today' },
  E2: { value: '1842', format: 'number', decimals: 0 },
  F2: { value: 'Team' },
  A3: { value: 'Maya Chen' },
  B3: { value: 'Lumen' },
  C3: { value: 'maya@lumen.example' },
  D3: { value: 'Yesterday' },
  E3: { value: '1204', format: 'number', decimals: 0 },
  F3: { value: 'Team' },
  A4: { value: 'Owen Park' },
  B4: { value: 'Fieldnote' },
  C4: { value: 'owen@fieldnote.example' },
  D4: { value: 'Sep 20' },
  E4: { value: '986', format: 'number', decimals: 0 },
  F4: { value: 'Pro' },
  A5: { value: 'Priya Shah' },
  B5: { value: 'Harbor' },
  C5: { value: 'priya@harbor.example' },
  D5: { value: 'Sep 19' },
  E5: { value: '874', format: 'number', decimals: 0 },
  F5: { value: 'Team' },
  A6: { value: 'Leo Martins' },
  B6: { value: 'Kindred' },
  C6: { value: 'leo@kindred.example' },
  D6: { value: 'Sep 18' },
  E6: { value: '731', format: 'number', decimals: 0 },
  F6: { value: 'Pro' },
  A7: { value: 'Sam Okonkwo' },
  B7: { value: 'Relay' },
  C7: { value: 'sam@relay.example' },
  D7: { value: 'Sep 17' },
  E7: { value: '655', format: 'number', decimals: 0 },
  F7: { value: 'Team' },
  A8: { value: 'Elena Voss' },
  B8: { value: 'Paperplane' },
  C8: { value: 'elena@paperplane.example' },
  D8: { value: 'Sep 15' },
  E8: { value: '512', format: 'number', decimals: 0 },
  F8: { value: 'Pro' },
};
