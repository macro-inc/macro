# XLSX interoperability fixtures

`financial-model.xlsx` and `namespaced-table.xlsx` are synthetic workbooks generated independently with openpyxl, not with Macro's ExcelJS exporter. Regenerate them with `python3 generate-financial.py` from this directory after installing openpyxl. No customer data is included.

The financial fixture covers cross-sheet and absolute/mixed references, global and local names, NPV/IRR/XIRR/PMT, SUMIFS, INDEX/MATCH, IFERROR, precision, accounting negative/zero sections, scaling, multiples, percentages, elapsed time, Excel's 1900 leap-day compatibility, fonts/colors, double borders, merges, hidden rows/columns/sheets, row heights, filters, and frozen panes. Tests check independently specified results, native Loro save/reopen, value and style edits, and Excel import/export round trips.

The namespaced fixture uses valid prefixed OOXML and absolute package relationship targets, including a table relationship. This catches ExcelJS parser assumptions that are not part of the Excel file format. Tables are intentionally represented as ordinary cells with an import warning.

Additional generated-in-test workbooks exercise the 1904 date system, stored Excel errors and their propagation, unsupported formats, malformed/oversized archives, cancellation, quoted Unicode CSV, long identifiers, and formula-like CSV text. Browser tests exercise real worker import, calculation, editing, and exported download contents.
