# Metadata import controls

These strings are exports from the web editor with document metadata and stable
node IDs registered. Compare exported bytes directly; object equality would miss
state-key order.

- `root-order.*`: the input places `documentMetadata` before an unknown sentinel
  and `id`; the editor emits the sentinel first, then `id` and `documentMetadata`.
- `equation-metadata.*`: a fresh equation factory model and its parse/export;
  parsing adds `environmentTags: null`.

Regenerate by exporting the same inputs from a web editor build with these nodes
registered.
