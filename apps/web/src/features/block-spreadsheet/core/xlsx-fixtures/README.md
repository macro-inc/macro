# XLSX interoperability fixtures

`financial-model.xlsx` and `namespaced-table.xlsx` are synthetic workbooks generated independently with openpyxl, not with Macro's exporter. Regenerate them with `python3 generate-financial.py` from this directory after installing openpyxl. No customer data is included.

`drawings.xlsx` holds charts (clustered columns, a line, a pie, stacked bars, an area, a scatter, a doughnut and columns with a line on a secondary axis, some reading another sheet) and a PNG logo, all written by openpyxl. Regenerate it with `python3 generate-drawings.py` (needs openpyxl and Pillow).

The financial fixture covers cross-sheet and absolute/mixed references, global and local names, NPV/IRR/XIRR/PMT, SUMIFS, INDEX/MATCH, IFERROR, precision, accounting negative/zero sections, scaling, multiples, percentages, elapsed time, Excel's 1900 leap-day compatibility, fonts/colors, double borders, merges, hidden rows/columns/sheets, row heights, filters, and frozen panes. Tests check independently specified results, native Loro save/reopen, value and style edits, and Excel import/export round trips.

The namespaced fixture uses valid prefixed OOXML and absolute package relationship targets, including a table relationship. This catches parser assumptions that are not part of the Excel file format. Tables are intentionally represented as ordinary cells with an import warning.

Additional generated-in-test workbooks exercise the 1904 date system, stored Excel errors and their propagation, unsupported formats, malformed/oversized archives, cancellation, quoted Unicode CSV, long identifiers, and formula-like CSV text. Browser tests exercise real worker import, calculation, editing, and exported download contents.

## Real-world corpus

`real-world/` holds published workbooks that Excel, LibreOffice and other producers wrote: financial models (project finance, DCF, LBO, loan schedules, three-statement models), small-business and government statistics workbooks, and files from open-source spreadsheet test suites. `corpus.ts` lists them from `real-world/manifest.json` and fails if a workbook has no recorded provenance. `../xlsx-corpus.test.ts` imports, recalculates and round-trips each one and snapshots the results.

Every file is redistributable. `manifest.json` records each file's source page and license:

| License | Files |
| --- | --- |
| Public domain (U.S. Government work, 17 U.S.C. 105) | 7 |
| Apache-2.0 (Apache POI test-data) | 7 |
| MIT OR Apache-2.0 (IronCalc) | 6 |
| CC-BY-4.0 | 5 |
| MIT | 5 |
| MPL-2.0 (LibreOffice core source tree) | 5 |
| Apache-2.0 (SheetJS test_files, original root-level file) | 3 |
| US federal government public information (SEC) | 2 |
| NLR/DOE Data & Software notice (free use/copy with notice retained) | 2 |
| Open Government Licence v3.0 | 2 |
| MIT (ClosedXML) | 2 |
| CC0-1.0 | 1 |
| Series data from BLS (public domain); FRED terms of use apply to the export | 1 |
| Open Government Licence v3.0 (Crown copyright) | 1 |
| CC BY 4.0 (World Bank) | 1 |
| MIT (.NET Foundation, Open-XML-SDK) | 1 |
| MIT (ExcelJS) | 1 |

Notices:

- **Open Government Licence v3.0** (OBR, ONS): contains public sector information licensed under the Open Government Licence v3.0, https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/.
- **CC BY 4.0** (Zenodo authors, World Bank): each file's authors and record are listed in `manifest.json`; files are unmodified. https://creativecommons.org/licenses/by/4.0/.
- **NREL System Advisor Model** exports: produced with SAM by NREL (now NLR) for the U.S. Department of Energy; used under NREL's data notice, which permits use and copying with this notice retained.
- **MIT / Apache-2.0 / MPL-2.0** files come from the IronCalc, Apache POI, LibreOffice, SheetJS, Open XML SDK, ClosedXML, ExcelJS and Packt repositories at the commits linked in `manifest.json`, under those projects' licenses.
- U.S. federal works (SEC, Census, BLS, BEA, IRS, SBA, GSA) are in the public domain; the FRED export carries BLS series data.

Templates whose terms forbid redistribution (Microsoft Create, Vertex42, Breaking Into Wall Street, Damodaran, SBDC) were used only for local testing and are not committed. Add a file by copying it here unmodified and adding its `file`, `title`, `source` and `license` to the manifest; set `skipCalculation` with a reason only when the engine cannot finish it.
