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
    use std::time::Duration;

    use model::document::FileType;

    use crate::config::LokPath;
    use crate::process::convert::{Conversion, convert_in_job_folder, run_lok_conversion};
    use crate::scratch::Scratch;
    use crate::utils::get_lok_filter_from_file_types;

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

    /// Upgrades a fixture and returns the OpenXML bytes.
    fn upgrade(name: &str, from: FileType, to: FileType) -> Vec<u8> {
        convert_bytes(&std::fs::read(fixture(name)).unwrap(), from, to)
    }

    fn lok_path() -> LokPath {
        LokPath::new().expect("set LOK_PATH to LibreOffice's program directory")
    }

    fn conversion(from: FileType, to: FileType) -> Conversion {
        let filter = get_lok_filter_from_file_types(&from, &to).unwrap();
        Conversion::new("legacy-upgrade-test", from, to, filter)
    }

    fn job_folders(root: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(root.join("jobs"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect()
    }

    /// LibreOffice scratch files in the host's temporary directory.
    fn host_scratch_files() -> Vec<String> {
        let mut names: Vec<_> = std::fs::read_dir(std::env::temp_dir())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("lu") && name.ends_with(".tmp"))
            .collect();
        names.sort();
        names
    }

    fn convert_bytes(input_bytes: &[u8], from: FileType, to: FileType) -> Vec<u8> {
        let root = tempfile::tempdir().unwrap();
        let scratch = Scratch::reset(root.path()).unwrap();

        let output = convert_in_job_folder(
            &scratch,
            lok_path().as_ref(),
            &conversion(from, to),
            input_bytes,
        )
        .unwrap();

        assert_eq!(job_folders(root.path()), Vec::<PathBuf>::new());
        output
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
        let root = tempfile::tempdir().unwrap();
        let scratch = Scratch::reset(root.path()).unwrap();
        let mut conversion = conversion(FileType::Ppt, FileType::Pptx);
        conversion.max_wait = Duration::from_secs(60);

        let result = convert_in_job_folder(
            &scratch,
            lok_path().as_ref(),
            &conversion,
            b"not a powerpoint file",
        );

        let error = result.unwrap_err().to_string();
        assert!(error.contains("conversion failed"), "{error}");
        assert_eq!(job_folders(root.path()), Vec::<PathBuf>::new());
    }

    #[test]
    #[ignore = "needs LibreOfficeKit; see module docs"]
    fn conversions_leave_no_libreoffice_scratch_files_outside_the_job_folder() {
        let before = host_scratch_files();

        let docx = upgrade("memo.doc", FileType::Doc, FileType::Docx);
        convert_bytes(&docx, FileType::Docx, FileType::Pdf);

        assert_eq!(host_scratch_files(), before);
    }

    #[test]
    #[ignore = "needs LibreOfficeKit; see module docs"]
    fn a_conversion_keeps_its_libreoffice_profile_in_its_folder() {
        // The profile is rewritten by every conversion. One shared by the host
        // would be written outside the job folder, by several jobs at once.
        let folder = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let input = folder.path().join("IN.doc");
        let output = folder.path().join("OUT.docx");
        std::fs::copy(fixture("memo.doc"), &input).unwrap();

        run_lok_conversion(
            &conversion(FileType::Doc, FileType::Docx),
            lok_path().as_ref(),
            folder.path(),
            cache.path(),
            &input,
            &output,
        )
        .unwrap();

        assert!(output.is_file());
        let profile = std::fs::read_dir(folder.path().join(".config"))
            .unwrap()
            .count();
        assert_eq!(profile, 1);
    }

    #[test]
    #[ignore = "needs LibreOfficeKit; see module docs"]
    fn a_conversion_killed_at_its_time_limit_leaves_nothing_behind() {
        let before = host_scratch_files();
        let root = tempfile::tempdir().unwrap();
        let scratch = Scratch::reset(root.path()).unwrap();
        let mut conversion = conversion(FileType::Doc, FileType::Docx);
        // LibreOffice takes longer than this to start.
        conversion.max_wait = Duration::from_millis(50);

        let result = convert_in_job_folder(
            &scratch,
            lok_path().as_ref(),
            &conversion,
            &std::fs::read(fixture("memo.doc")).unwrap(),
        );

        let error = result.unwrap_err().to_string();
        assert!(error.contains("timed out"), "{error}");
        assert_eq!(job_folders(root.path()), Vec::<PathBuf>::new());
        assert_eq!(host_scratch_files(), before);
    }

    #[test]
    #[ignore = "needs LibreOfficeKit; see module docs"]
    fn conversions_run_side_by_side() {
        // The worker converts a batch of messages at once.
        let memo = std::fs::read(fixture("memo.doc")).unwrap();

        let outputs: Vec<Vec<u8>> = std::thread::scope(|scope| {
            let jobs: Vec<_> = (0..4)
                .map(|_| scope.spawn(|| convert_bytes(&memo, FileType::Doc, FileType::Docx)))
                .collect();
            jobs.into_iter().map(|job| job.join().unwrap()).collect()
        });

        for docx in outputs {
            assert!(zip_part(&docx, "word/document.xml").contains("Quarterly Memo"));
        }
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

mod child_process {
    //! Forks real child processes. None of them needs LibreOffice.

    use std::io::Read;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use nix::sys::resource::{Resource, getrlimit};
    use nix::sys::signal::{Signal, raise};
    use nix::unistd::{ForkResult, fork, pause};

    use crate::process::child::{ChildExit, run_confined};

    const TIME_LIMIT: Duration = Duration::from_secs(30);

    #[test]
    fn a_child_that_finishes_its_work_succeeds() {
        let folder = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();

        let exit = run_confined(folder.path(), cache.path(), TIME_LIMIT, || Ok(())).unwrap();

        assert_eq!(exit, ChildExit::Succeeded);
    }

    #[test]
    fn a_child_starts_while_other_threads_read_the_environment() {
        // A child forked while another thread reads the environment inherits
        // the standard library's environment lock held, with no thread left
        // to release it.
        let folder = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let stop = AtomicBool::new(false);

        let unfinished = std::thread::scope(|scope| {
            for _ in 0..4 {
                scope.spawn(|| {
                    while !stop.load(Ordering::Relaxed) {
                        std::hint::black_box(std::env::var_os("HOME"));
                    }
                });
            }

            let unfinished = (0..50)
                .map(|_| run_confined(folder.path(), cache.path(), TIME_LIMIT, || Ok(())))
                .find(|exit| !matches!(exit, Ok(ChildExit::Succeeded)));
            stop.store(true, Ordering::Relaxed);
            unfinished
        });

        assert!(unfinished.is_none(), "{unfinished:?}");
    }

    #[test]
    fn a_child_whose_work_fails_reports_the_failure() {
        let folder = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();

        let exit = run_confined(folder.path(), cache.path(), TIME_LIMIT, || {
            anyhow::bail!("unable to load document")
        })
        .unwrap();

        assert_eq!(exit, ChildExit::Failed(1));
    }

    #[test]
    fn a_child_whose_work_panics_exits_instead_of_running_the_parents_code() {
        let folder = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();

        let exit = run_confined(folder.path(), cache.path(), TIME_LIMIT, || {
            panic!("conversion panicked")
        })
        .unwrap();

        assert_eq!(exit, ChildExit::Failed(101));
    }

    #[test]
    fn a_child_that_crashes_reports_its_signal() {
        let folder = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();

        let exit = run_confined(folder.path(), cache.path(), TIME_LIMIT, || {
            raise(Signal::SIGABRT)?;
            Ok(())
        })
        .unwrap();

        assert_eq!(exit, ChildExit::Signaled(Signal::SIGABRT));
    }

    #[test]
    fn a_child_still_running_at_its_time_limit_is_killed() {
        let folder = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();

        let exit = run_confined(
            folder.path(),
            cache.path(),
            Duration::from_millis(100),
            || -> anyhow::Result<()> {
                loop {
                    pause();
                }
            },
        )
        .unwrap();

        assert_eq!(exit, ChildExit::TimedOut);
    }

    #[test]
    fn a_child_killed_at_its_time_limit_takes_the_processes_it_started_with_it() {
        let folder = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let (mut reader, writer) = std::io::pipe().unwrap();

        let exit = run_confined(
            folder.path(),
            cache.path(),
            Duration::from_millis(100),
            move || -> anyhow::Result<()> {
                // The child and the process it starts both hold the pipe open
                // for as long as they live.
                let _writer = writer;
                if let ForkResult::Child = unsafe { fork() }? {
                    loop {
                        pause();
                    }
                }
                loop {
                    pause();
                }
            },
        )
        .unwrap();
        assert_eq!(exit, ChildExit::TimedOut);

        // The pipe reaches its end only once every process holding it is gone.
        let (done, finished) = std::sync::mpsc::channel();
        std::thread::spawn(move || done.send(reader.read(&mut [0u8; 1])));
        let read = finished.recv_timeout(TIME_LIMIT).unwrap().unwrap();
        assert_eq!(read, 0);
    }

    #[test]
    fn a_child_writes_only_inside_its_folder() {
        let folder = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();

        let exit = run_confined(folder.path(), cache.path(), TIME_LIMIT, || {
            let (core_soft, core_hard) = getrlimit(Resource::RLIMIT_CORE)?;
            let observed = format!(
                "TMPDIR={:?}\nHOME={:?}\nXDG_CACHE_HOME={:?}\nXDG_CONFIG_HOME={:?}\ncore={core_soft},{core_hard}\n",
                std::env::temp_dir(),
                std::env::var_os("HOME"),
                std::env::var_os("XDG_CACHE_HOME"),
                std::env::var_os("XDG_CONFIG_HOME"),
            );
            // A relative path resolves against the working directory.
            std::fs::write("observed", observed)?;
            Ok(())
        })
        .unwrap();

        assert_eq!(exit, ChildExit::Succeeded);
        let observed = std::fs::read_to_string(folder.path().join("observed")).unwrap();
        let expected = format!(
            "TMPDIR={:?}\nHOME={:?}\nXDG_CACHE_HOME={:?}\nXDG_CONFIG_HOME=None\ncore=0,0\n",
            folder.path(),
            Some(folder.path().as_os_str()),
            Some(cache.path().as_os_str()),
        );
        assert_eq!(observed, expected);
    }
}

mod job_folders {
    //! A job's folder is gone once the job is, however the job ended.

    use model::document::FileType;

    use crate::process::convert::{Conversion, convert_in_job_folder};
    use crate::scratch::Scratch;

    #[test]
    fn a_failed_conversion_leaves_no_job_folder() {
        let root = tempfile::tempdir().unwrap();
        let scratch = Scratch::reset(root.path()).unwrap();
        let conversion = Conversion::new(
            "job-1",
            FileType::Docx,
            FileType::Pdf,
            "writer_pdf_Export".to_string(),
        );

        // LibreOffice is not installed here, so the child process fails.
        let result = convert_in_job_folder(
            &scratch,
            "/nonexistent/libreoffice/program",
            &conversion,
            b"input",
        );

        let error = result.unwrap_err().to_string();
        assert!(error.contains("conversion failed"), "{error}");
        assert_eq!(
            std::fs::read_dir(root.path().join("jobs")).unwrap().count(),
            0
        );
    }
}

mod disk_pause {
    //! The worker leaves messages on the queue while the disk is low.

    use std::time::Duration;

    use crate::disk::DiskGuard;
    use crate::process::runner::wait_for_disk_space;

    #[tokio::test(start_paused = true)]
    async fn the_worker_waits_for_as_long_as_the_disk_is_low() {
        let dir = tempfile::tempdir().unwrap();
        let disk = DiskGuard::new(dir.path(), u64::MAX, 0);

        let waited = tokio::time::timeout(Duration::from_secs(3600), wait_for_disk_space(&disk));

        assert!(waited.await.is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn the_worker_does_not_wait_when_the_disk_has_room() {
        let dir = tempfile::tempdir().unwrap();
        let disk = DiskGuard::new(dir.path(), 0, 0);
        let started = tokio::time::Instant::now();

        wait_for_disk_space(&disk).await;

        assert_eq!(started.elapsed(), Duration::ZERO);
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

    use std::sync::Arc;

    use crate::process::convert::process_message;
    use crate::scratch::Scratch;

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
    async fn run(scratch: &Arc<Scratch>, message: &Message) -> (anyhow::Result<()>, SpanData) {
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
            process_message(&worker(), &s3(), &lambda(), scratch, message).await
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
    async fn a_job_that_fails_before_converting_errors_the_span_by_its_failure() {
        let root = tempfile::tempdir().unwrap();
        let scratch = Arc::new(Scratch::reset(root.path()).unwrap());
        let message = message(
            "process-message-span-unsupported",
            "uploads/notes.txt",
            "uploads/notes.pdf",
        );

        let (result, span) = run(&scratch, &message).await;

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_dir(root.path().join("jobs")).unwrap().count(),
            0
        );
        let Status::Error { description } = &span.status else {
            panic!("expected an errored span, got {:?}", span.status);
        };
        assert!(
            description.contains("unsupported conversion"),
            "span error should be the conversion failure: {description}"
        );
    }
}

mod job_updates {
    //! What a finished conversion reports to the job update handler, which
    //! rejects updates for jobs it does not track.

    use model::convert::ConvertQueueMessage;
    use serde_json::json;

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
