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

    use shared_types::document::FileType;

    use crate::config::LokPath;
    use crate::process::convert::run_lok_conversion;
    use crate::utils::{conversion_timeout, get_lok_filter_from_file_types};

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/legacy")
            .join(name)
    }

    fn fonts() -> pptx_engine::font::FontDb {
        let dir =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../crates/engines/pptx_engine/fonts");
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
        archive
            .file_names()
            .map(|name| name.unwrap().into_owned())
            .collect()
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
    fn conversions_leave_no_libreoffice_scratch_files_outside_the_job_folder() {
        // The worker only removes the job folder, and a child killed at its
        // timeout never runs LibreOffice's own scratch cleanup.
        let scratch = || {
            let mut names: Vec<_> = std::fs::read_dir(std::env::temp_dir())
                .unwrap()
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|name| name.starts_with("lu") && name.ends_with(".tmp"))
                .collect();
            names.sort();
            names
        };
        let before = scratch();

        let docx = upgrade("memo.doc", FileType::Doc, FileType::Docx);
        convert_bytes(&docx, FileType::Docx, FileType::Pdf);

        assert_eq!(scratch(), before);
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
    use shared_types::document::FileType;

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

mod job_cleanup {
    //! Tests `remove_job_folder` directly: CI builds with `--all-features`,
    //! where `disable_cleanup` turns `cleanup_folder` into a no-op.

    use std::path::Path;

    use crate::utils::remove_job_folder;

    /// Removes a job folder prepared by `setup` and checks the outcome.
    fn check(setup: fn(&Path), expect_ok: bool) {
        let root = tempfile::tempdir().unwrap();
        let job = root.path().join("job");
        setup(&job);

        let result = remove_job_folder(job.to_str().unwrap());

        assert_eq!(result.is_ok(), expect_ok, "{result:?}");
        if expect_ok {
            assert!(!job.exists());
        }
    }

    #[test]
    fn removes_the_job_folder() {
        check(
            |job| {
                std::fs::create_dir(job).unwrap();
                std::fs::write(job.join("IN.docx"), b"input").unwrap();
            },
            true,
        );
    }

    #[test]
    fn a_job_that_failed_before_creating_its_folder_cleans_up() {
        check(|_| {}, true);
    }

    #[test]
    fn other_failures_still_surface() {
        check(|job| std::fs::write(job, b"not a folder").unwrap(), false);
    }
}

mod process_message_span {
    //! Exports `process_message` spans with the error-event-to-status mapping
    //! the service's OTel layer uses, so a span's status here matches what
    //! Datadog counts as a span error.

    use aws_sdk_sqs::types::{Message, MessageAttributeValue};
    use opentelemetry::trace::{Status, TracerProvider as _};
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
    use tracing_subscriber::layer::SubscriberExt as _;

    use crate::process::convert::process_message;

    fn s3() -> s3_client::S3 {
        let config = aws_sdk_s3::Config::builder()
            .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
            .region(aws_sdk_s3::config::Region::new("us-east-1"))
            .build();
        s3_client::S3::new(aws_sdk_s3::Client::from_conf(config))
    }

    fn lambda() -> lambda_client::Lambda {
        let config = aws_sdk_lambda::Config::builder()
            .behavior_version(aws_sdk_lambda::config::BehaviorVersion::latest())
            .region(aws_sdk_lambda::config::Region::new("us-east-1"))
            .build();
        lambda_client::Lambda::new(aws_sdk_lambda::Client::from_conf(config))
    }

    fn worker() -> sqs_worker::SQSWorker {
        let config = aws_sdk_sqs::Config::builder()
            .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
            .region(aws_sdk_sqs::config::Region::new("us-east-1"))
            .build();
        sqs_worker::SQSWorker::new(
            aws_sdk_sqs::Client::from_conf(config),
            "https://sqs.us-east-1.amazonaws.com/0/convert".to_string(),
            1,
            0,
        )
    }

    /// A queue message for `job_id` converting `from_key` to `to_key`.
    fn message(job_id: &str, from_key: &str, to_key: &str) -> Message {
        let body = serde_json::json!({
            "job_id": job_id,
            "from_bucket": "from-bucket",
            "to_bucket": "to-bucket",
            "from_key": from_key,
            "to_key": to_key,
        });
        Message::builder()
            .message_id("message")
            .message_attributes(
                "job_id",
                MessageAttributeValue::builder()
                    .data_type("String")
                    .string_value(job_id)
                    .build()
                    .unwrap(),
            )
            .body(body.to_string())
            .build()
    }

    /// Runs `process_message` and returns its result and exported span.
    async fn run(message: &Message) -> (anyhow::Result<()>, SpanData) {
        let exporter = InMemorySpanExporter::default();
        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        let layer = tracing_opentelemetry::layer()
            .with_tracer(provider.tracer("test"))
            .with_error_events_to_status(true);
        let result = {
            let _guard =
                tracing::subscriber::set_default(tracing_subscriber::registry().with(layer));
            tracing::callsite::rebuild_interest_cache();
            process_message(&worker(), &s3(), &lambda(), message).await
        };

        let span = exporter
            .get_finished_spans()
            .unwrap()
            .into_iter()
            .find(|span| span.name == "process_message")
            .expect("process_message span");
        (result, span)
    }

    #[tokio::test]
    async fn a_job_that_fails_before_creating_its_folder_errors_the_span_by_its_failure() {
        let job_id = "process-message-span-unsupported";
        let (result, span) = run(&message(job_id, "uploads/notes.txt", "uploads/notes.pdf")).await;

        assert!(result.is_err());
        assert!(!std::path::Path::new(job_id).exists());
        let Status::Error { description } = &span.status else {
            panic!("expected an errored span, got {:?}", span.status);
        };
        assert!(
            description.contains("unsupported conversion"),
            "span error should be the conversion failure: {description}"
        );
        let events: Vec<_> = span.events.iter().map(|event| &*event.name).collect();
        assert!(
            !events.contains(&"unable to cleanup folder"),
            "cleaning up a missing folder must not log an error: {events:?}"
        );
    }
}

mod job_updates {
    //! What a finished conversion reports to the job update handler, which
    //! rejects updates for jobs it does not track.

    use serde_json::json;
    use shared_types::convert::ConvertQueueMessage;

    use crate::process::convert::job_update;

    #[test]
    fn a_tracked_docx_conversion_reports_completion() {
        let req: ConvertQueueMessage = serde_json::from_value(json!({
            "job_id": "job-1",
            "from_bucket": "docx-upload",
            "to_bucket": "doc-storage",
            "from_key": "owner/doc/1.docx",
            "to_key": "owner/doc/converted.pdf",
            "notify_job": true,
        }))
        .unwrap();

        let update = serde_json::to_value(job_update("job-1", &req, true)).unwrap();

        assert_eq!(update["jobId"], "job-1");
        assert_eq!(update["status"], "Completed");
        assert_eq!(update["jobType"], "docx_upload");
        assert_eq!(update["data"]["error"], false);
        assert_eq!(update["data"]["data"]["converted"], true);
    }

    #[test]
    fn a_tracked_docx_conversion_reports_failure() {
        let req: ConvertQueueMessage = serde_json::from_value(json!({
            "job_id": "job-1",
            "from_bucket": "docx-upload",
            "to_bucket": "doc-storage",
            "from_key": "owner/doc/1.docx",
            "to_key": "owner/doc/converted.pdf",
            "notify_job": true,
        }))
        .unwrap();

        let update = serde_json::to_value(job_update("job-1", &req, false)).unwrap();

        assert_eq!(update["status"], "Failed");
        assert_eq!(update["data"]["error"], true);
        assert_eq!(update["data"]["message"], "error converting document");
    }

    #[test]
    fn a_conversion_without_a_job_reports_nothing() {
        let req: ConvertQueueMessage = serde_json::from_value(json!({
            "job_id": "minted",
            "from_bucket": "docx-upload",
            "to_bucket": "doc-storage",
            "from_key": "owner/doc/1.docx",
            "to_key": "owner/doc/converted.pdf",
            "notify_job": false,
        }))
        .unwrap();

        assert!(job_update("minted", &req, true).is_none());
        assert!(job_update("minted", &req, false).is_none());
    }

    #[test]
    fn messages_from_older_producers_still_report() {
        let req: ConvertQueueMessage = serde_json::from_value(json!({
            "job_id": "job-1",
            "from_bucket": "docx-upload",
            "to_bucket": "doc-storage",
            "from_key": "owner/doc/1.docx",
            "to_key": "owner/doc/converted.pdf",
        }))
        .unwrap();

        assert!(job_update("job-1", &req, false).is_some());
    }

    #[test]
    fn non_docx_conversions_report_nothing() {
        let req: ConvertQueueMessage = serde_json::from_value(json!({
            "job_id": "job-1",
            "from_bucket": "doc-storage",
            "to_bucket": "doc-storage",
            "from_key": "owner/doc/13664129",
            "to_key": "owner/doc/upgraded.docx",
            "from_file_type": "doc",
            "to_file_type": "docx",
        }))
        .unwrap();

        assert!(job_update("job-1", &req, true).is_none());
    }
}
