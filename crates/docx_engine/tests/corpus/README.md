# DOCX fidelity corpus

`manifest.json` lists the documents the engine is scored on: 61 public
`.docx` files, 36 of them legal (contracts, NVCA and YC financing forms,
court forms, UN resolutions and treaties, constitutions, grant agreements),
plus reports, forms and academic templates. Each entry records its source
URL, licence and provenance, what it exercises (numbering, fields, tables,
floats, sections, notes, tracked changes...) and, for 18 of them, a PDF that
Word itself exported (`word_pdf`), which is the ground truth for layout. The
files themselves stay with their publishers and are not committed.

```sh
S=/tmp/docx-corpus
python3 crates/docx_engine/scripts/fetch_corpus.py $S/corpus
cargo run --release -p docx_engine --features cli --bin docx_corpus -- fontconfig --out $S/fonts.conf
python3 crates/docx_engine/scripts/render_references.py $S/refs $S/corpus/*.docx --fontconfig $S/fonts.conf --jobs 4
cargo run --release -p docx_engine --features cli --bin docx_corpus -- score --refs $S/refs --out $S/score --jobs 4 $S/corpus/*.docx
```

`render_references.py` renders each document with LibreOffice (headless,
PDF export, using the engine's bundled fonts through the generated
fontconfig file so differences are layout rather than font choice) and
rasterizes Word's PDFs where they exist. `score` renders every page with the
engine, compares it with both references (SSIM per page, page counts) and
writes `index.html` with side-by-side pages, plus `scores.json`. `lines`
dumps the engine's text lines with positions for comparing line breaks
with a reference PDF's.

Scores as of this writing: against Word, mean SSIM 0.67 with equal page
counts for 14 of 18 documents; against LibreOffice 24.2, mean SSIM 0.63 with
equal page counts for 38 of 61.
