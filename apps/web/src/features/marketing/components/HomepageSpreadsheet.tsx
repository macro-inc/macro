import { downloadFile } from '@filesystem/download';
import type { SpreadsheetCells } from '@macro-inc/spreadsheet/spreadsheet-document';
import { createLocalSpreadsheetSource } from '../../block-spreadsheet/primitives/create-local-spreadsheet-source';
import { createSpreadsheetStore } from '../../block-spreadsheet/primitives/create-spreadsheet-store';
import { SpreadsheetEditor } from '../../block-spreadsheet/views/SpreadsheetEditor';

const header = (value: string) => ({ value, bold: true });

/** Local example only. These are not real customers. */
const CUSTOMERS: SpreadsheetCells = {
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

const NAME = 'Customers to reach';

/** The production spreadsheet editor, with a local customer list and no server save. */
export default function HomepageSpreadsheet() {
  const source = createLocalSpreadsheetSource(CUSTOMERS);
  const store = createSpreadsheetStore({ source, canEdit: () => true });
  store.renameSheet(store.activeSheetId(), 'Top customers');
  store.resizeColumn(0, 150);
  store.resizeColumn(1, 120);
  store.resizeColumn(2, 210);
  store.resizeColumn(3, 120);
  store.resizeColumn(4, 90);
  store.resizeColumn(5, 80);

  return (
    <div class="relative pb-24">
      <div class="workspace-demo homepage-spreadsheet">
        <div class="homepage-compose-status">
          <span>{NAME}</span>
          <span>Interactive demo</span>
        </div>
        <div class="min-h-0 flex-1">
          <SpreadsheetEditor
            store={store}
            name={NAME}
            onExportXlsx={(bytes) =>
              downloadFile(
                new Blob([bytes.slice().buffer], {
                  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                }),
                `${NAME}.xlsx`
              )
            }
            onExport={(content) =>
              downloadFile(
                new Blob([content], { type: 'text/csv;charset=utf-8' }),
                `${NAME}.csv`
              )
            }
          />
        </div>
      </div>
      <div class="pointer-events-none absolute bottom-0 left-2 z-10 text-ink-muted sm:left-6">
        <span class="sr-only">Interactive demo — try editing a cell.</span>
        <svg
          class="h-[160px] w-[200px] -rotate-6"
          viewBox="0 0 200 165"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          {/* Hand-lettered so the marker note stays consistent without a font download. */}
          <path d="M59 112C8 99 8 47 38 7M22 13C28 12 33 9 38 7C38 14 39 19 41 24" />
          <g transform="translate(0 40)">
            <path d="M70 70C84 68 98 67 108 69M91 69L87 102" />
            <path d="M107 81L104 101M106 88C113 76 120 77 123 80" />
            <path d="M127 80C124 89 125 94 130 94C137 94 141 82 143 78M143 78C137 101 135 115 123 116C116 116 116 111 121 108" />
            <path d="M163 85L160 103M165 75L165 76M181 75L174 98Q174 105 182 100M167 85L186 83" />
          </g>
        </svg>
      </div>
    </div>
  );
}
