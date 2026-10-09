use super::convert::is_docx_key;

#[test]
fn docx_detection_accepts_mixed_case_extensions() {
    assert!(is_docx_key("uploads/report.DOCX"));
    assert!(is_docx_key("uploads/report.DoCx"));
}

#[test]
fn docx_detection_requires_the_final_extension() {
    assert!(!is_docx_key("uploads/report.docx.tmp"));
    assert!(!is_docx_key("uploads/docx"));
}

mod legacy_upgrade {
    //! Real LibreOfficeKit conversions of legacy Office fixtures, checked by
    //! opening the results in the engines that serve them.
    //!
    //! Needs LibreOffice (with Writer, Calc and Impress) on the host:
    //! `LOK_PATH=/usr/lib/libreoffice/program cargo test -p convert_service -- --ignored`.

    use std::io::Read;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::time::Duration;

    use model::document::FileType;

    use crate::config::LokPath;
    use crate::process::convert::run_lok_conversion;
    use crate::utils::{conversion_timeout, get_lok_filter_from_file_types};

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/legacy")
            .join(name)
    }

    fn fonts() -> pptx_engine::font::FontDb {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../crates/pptx_engine/fonts");
        let mut db = pptx_engine::font::FontDb::new();
        let mut files: Vec<_> = std::fs::read_dir(dir)
            .expect("pptx_engine fonts")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("ttf") || e.eq_ignore_ascii_case("otf"))
            })
            .collect();
        files.sort();
        for file in files {
            db.register(std::fs::read(file).expect("font file"));
        }
        db
    }

    /// LibreOffice shares one user profile per host, so conversions run one
    /// at a time, as the worker does.
    static LOK: Mutex<()> = Mutex::new(());

    /// Upgrades a fixture and returns the OpenXML bytes.
    fn upgrade(name: &str, from: FileType, to: FileType) -> Vec<u8> {
        convert_bytes(&std::fs::read(fixture(name)).unwrap(), from, to)
    }

    fn convert_bytes(input_bytes: &[u8], from: FileType, to: FileType) -> Vec<u8> {
        let _lok = LOK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let lok_path = LokPath::new().expect("set LOK_PATH to LibreOffice's program directory");
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join(format!("IN.{}", from.as_str()));
        let output = dir.path().join(format!("OUT.{}", to.as_str()));
        std::fs::write(&input, input_bytes).unwrap();

        let filter = get_lok_filter_from_file_types(&from, &to).unwrap();
        run_lok_conversion(
            "legacy-upgrade-test",
            lok_path.as_ref(),
            input.to_str().unwrap(),
            output.to_str().unwrap(),
            to.as_str(),
            &filter,
            conversion_timeout(&from, &to),
        )
        .unwrap();
        std::fs::read(output).unwrap()
    }

    fn zip_part(bytes: &[u8], name: &str) -> String {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut part = archive
            .by_name(name)
            .unwrap_or_else(|_| panic!("missing part {name}"));
        let mut text = String::new();
        part.read_to_string(&mut text).unwrap();
        text
    }

    fn zip_names(bytes: &[u8]) -> Vec<String> {
        let archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        archive.file_names().map(str::to_string).collect()
    }

    fn assert_main_content_type(bytes: &[u8], content_type: &str) {
        let types = zip_part(bytes, "[Content_Types].xml");
        assert!(types.contains(content_type), "{types}");
    }

    #[test]
    #[ignore = "needs LibreOfficeKit; see module docs"]
    fn doc_upgrades_to_a_docx_the_word_engine_lays_out() {
        let docx = upgrade("memo.doc", FileType::Doc, FileType::Docx);

        assert_main_content_type(
            &docx,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        );
        let xml = zip_part(&docx, "word/document.xml");
        for text in [
            "Quarterly Memo",
            "twelve percent",
            "Launched the new editor",
            "Revenue",
            "Margin",
            "Café façade naïve",
        ] {
            assert!(xml.contains(text), "missing {text:?}");
        }
        // Bold run, table, page break, list numbering and the picture survive.
        assert!(
            xml.contains("<w:b/>") || xml.contains("<w:b "),
            "bold run lost"
        );
        assert!(xml.contains("<w:tbl>"), "table lost");
        assert!(xml.contains(r#"w:type="page""#), "page break lost");
        assert!(xml.contains("<w:numPr>"), "list numbering lost");
        assert!(
            zip_names(&docx)
                .iter()
                .any(|name| name.starts_with("word/media/")),
            "picture lost"
        );

        let document = docx_engine::Document::open(docx).expect("docx engine opens the upgrade");
        let layout = document.layout(&fonts());
        assert!(layout.pages.len() >= 2, "page break should give two pages");
    }

    #[test]
    #[ignore = "needs LibreOfficeKit; see module docs"]
    fn ppt_upgrades_to_a_pptx_the_presentation_engine_renders() {
        let pptx = upgrade("deck.ppt", FileType::Ppt, FileType::Pptx);

        assert_main_content_type(
            &pptx,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        );
        let names = zip_names(&pptx);
        assert!(
            names.iter().any(|name| name.starts_with("ppt/media/")),
            "picture lost"
        );
        assert!(
            names
                .iter()
                .any(|name| name.starts_with("ppt/notesSlides/")),
            "speaker notes lost"
        );

        let mut presentation =
            pptx_engine::Presentation::open(pptx.clone()).expect("pptx engine opens the upgrade");
        assert_eq!(presentation.slides().len(), 4);
        let fonts = fonts();
        for index in 0..presentation.slides().len() {
            presentation
                .render_slide(index, 320, &fonts)
                .unwrap_or_else(|e| panic!("slide {} failed to render: {e}", index + 1));
        }

        let slides: String = (1..=4)
            .map(|n| zip_part(&pptx, &format!("ppt/slides/slide{n}.xml")))
            .collect();
        for text in [
            "Board Update",
            "October 2026",
            "Revenue up 12%",
            "Three new customers",
            "Numbers",
            "Margin",
            "Shape text",
        ] {
            assert!(slides.contains(text), "missing {text:?}");
        }
        assert!(slides.contains("<a:tbl>"), "table lost");
        let notes: String = names
            .iter()
            .filter(|name| name.starts_with("ppt/notesSlides/") && name.ends_with(".xml"))
            .map(|name| zip_part(&pptx, name))
            .collect();
        assert!(notes.contains("Speaker notes survive"));
    }

    #[test]
    #[ignore = "needs LibreOfficeKit; see module docs"]
    fn xls_upgrades_to_an_xlsx_with_formulas_and_sheets() {
        let xlsx = upgrade("budget.xls", FileType::Xls, FileType::Xlsx);

        assert_main_content_type(
            &xlsx,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        );
        let workbook = zip_part(&xlsx, "xl/workbook.xml");
        assert!(workbook.contains(r#"name="Budget""#), "{workbook}");
        assert!(workbook.contains(r#"name="Notes""#), "{workbook}");

        let budget = zip_part(&xlsx, "xl/worksheets/sheet1.xml");
        for formula in ["SUM(B2:B13)", "SUM(D2:D13)", "B2-C2", "B13-C13"] {
            assert!(budget.contains(formula), "missing formula {formula}");
        }
        assert!(budget.contains(r#"<mergeCell ref="F1:H1""#), "merge lost");
        // Cached results are written so a reader shows values before recalculating.
        assert!(budget.contains("<v>15900</v>"), "total revenue cache lost");

        let notes = zip_part(&xlsx, "xl/worksheets/sheet2.xml");
        assert!(
            notes.contains("Budget!D15/Budget!B15"),
            "cross-sheet formula lost"
        );

        let strings = zip_part(&xlsx, "xl/sharedStrings.xml");
        for text in ["Month", "Revenue", "Merged header", "Total", "Finance"] {
            assert!(strings.contains(text), "missing {text:?}");
        }
        let styles = zip_part(&xlsx, "xl/styles.xml");
        assert!(styles.contains("#,##0.00"), "number format lost");
    }

    #[test]
    #[ignore = "needs LibreOfficeKit; see module docs"]
    fn unreadable_input_fails_instead_of_hanging() {
        let _lok = LOK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let lok_path = LokPath::new().expect("set LOK_PATH to LibreOffice's program directory");
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("IN.ppt");
        std::fs::write(&input, b"not a powerpoint file").unwrap();

        let result = run_lok_conversion(
            "legacy-upgrade-garbage",
            lok_path.as_ref(),
            input.to_str().unwrap(),
            dir.path().join("OUT.pptx").to_str().unwrap(),
            "pptx",
            "",
            Duration::from_secs(60),
        );

        assert!(result.is_err());
    }

    #[test]
    #[ignore = "needs LibreOfficeKit; see module docs"]
    fn upgraded_docx_still_exports_to_pdf() {
        // The DOCX pipeline converts every Word upload to PDF, including upgrades.
        let docx = upgrade("memo.doc", FileType::Doc, FileType::Docx);

        let pdf = convert_bytes(&docx, FileType::Docx, FileType::Pdf);

        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() > 1_000);
    }

    #[test]
    #[ignore = "needs LibreOfficeKit; see module docs"]
    fn upgraded_pptx_still_exports_to_pdf() {
        let pptx = upgrade("deck.ppt", FileType::Ppt, FileType::Pptx);

        let pdf = convert_bytes(&pptx, FileType::Pptx, FileType::Pdf);

        assert!(pdf.starts_with(b"%PDF-"));
    }
}

mod conversion_table {
    use model::document::FileType;

    use crate::utils::{conversion_timeout, get_lok_filter_from_file_types, resolve_file_type};

    #[test]
    fn legacy_upgrades_are_supported() {
        for (from, to) in [
            (FileType::Doc, FileType::Docx),
            (FileType::Xls, FileType::Xlsx),
            (FileType::Ppt, FileType::Pptx),
        ] {
            assert_eq!(get_lok_filter_from_file_types(&from, &to).unwrap(), "");
            assert_eq!(conversion_timeout(&from, &to).as_secs(), 120);
        }
    }

    #[test]
    fn existing_exports_keep_their_filters() {
        assert_eq!(
            get_lok_filter_from_file_types(&FileType::Docx, &FileType::Pdf).unwrap(),
            "writer_pdf_Export"
        );
        assert_eq!(
            get_lok_filter_from_file_types(&FileType::Xlsx, &FileType::Html).unwrap(),
            "calc_HTML_WebQuery"
        );
        assert_eq!(
            get_lok_filter_from_file_types(&FileType::Pptx, &FileType::Pdf).unwrap(),
            "impress_pdf_Export"
        );
        assert_eq!(
            conversion_timeout(&FileType::Docx, &FileType::Pdf).as_secs(),
            30
        );
    }

    #[test]
    fn unsupported_pairs_are_rejected() {
        for (from, to) in [
            (FileType::Doc, FileType::Pdf),
            (FileType::Ppt, FileType::Docx),
            (FileType::Docx, FileType::Doc),
            (FileType::Xlsm, FileType::Xlsx),
        ] {
            assert!(
                get_lok_filter_from_file_types(&from, &to).is_err(),
                "{from}->{to}"
            );
        }
    }

    #[test]
    fn explicit_types_win_over_key_extensions() {
        assert_eq!(
            resolve_file_type(Some(FileType::Ppt), "owner/doc/12").unwrap(),
            FileType::Ppt
        );
        assert_eq!(
            resolve_file_type(Some(FileType::Doc), "owner/doc/7.docx").unwrap(),
            FileType::Doc
        );
    }

    #[test]
    fn key_extensions_are_used_without_explicit_types() {
        assert_eq!(
            resolve_file_type(None, "owner/doc/converted.pdf").unwrap(),
            FileType::Pdf
        );
        assert_eq!(
            resolve_file_type(None, "macro|a.b@c.com/doc/upgraded.PPTX").unwrap(),
            FileType::Pptx
        );
        assert_eq!(
            resolve_file_type(None, "owner/doc/7.docx").unwrap(),
            FileType::Docx
        );
    }

    #[test]
    fn versioned_keys_need_explicit_types() {
        assert!(resolve_file_type(None, "owner/doc/12").is_err());
        // A dotted owner segment is not an extension.
        assert!(resolve_file_type(None, "macro|first.last@macro.com/doc/12").is_err());
    }
}
