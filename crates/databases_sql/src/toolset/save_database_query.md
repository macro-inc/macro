Save a read-only SELECT as a live question and get back the block that shows its answer. Paste the returned `markdown` verbatim, into your reply or into a document with CreateDocument/EditDocument, and it renders as a live number, table, or chart that re-runs for whoever views it, with their permissions, so it stays current as the data changes.

Use it whenever the user asks a question about their data or asks for a chart. Run the SELECT with QueryDatabase first to check it returns what you expect, then save exactly that SQL. The SQL is QueryDatabase's dialect, described there, limited to one SELECT.

- `displayMode`: `scalar` for one number (a single COUNT/SUM/AVG), `table` for rows, `bar` to compare categories, `line` for a trend over an ordered column, `area` for a trend whose series add up to a whole, `scatter` to plot one numeric column against another, `pie` for shares of a whole.
- `chart` (bar/line/area/scatter/pie): `x` is the label column and `y` the numeric result columns, named exactly as the result columns are; alias aggregates (`COUNT(*) AS invites`) so they have stable names. `color` names a result column whose values split one `y` series into one series per value (e.g. invites per party colored by status); `stack` stacks bar or area series instead of setting them side by side.
- Pass `databaseId` so the question resolves against that database's tables.

Saved questions never change. To change one, save a new one and use its new block.