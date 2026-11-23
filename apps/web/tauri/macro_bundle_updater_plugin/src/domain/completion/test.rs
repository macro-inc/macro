use std::path::PathBuf;

use super::{BundleFile, CompletionRecord};

#[test]
fn record_with_files_round_trips() {
    let record = CompletionRecord::new(
        42,
        vec![
            BundleFile {
                path: PathBuf::from("index.html"),
                size: 120,
            },
            BundleFile {
                path: PathBuf::from("assets/startup 1.js"),
                size: 0,
            },
        ],
    )
    .unwrap();

    let rendered = record.render();

    assert_eq!(
        rendered,
        "42\nfiles 2\n120 index.html\n0 assets/startup 1.js\n"
    );
    assert_eq!(CompletionRecord::parse(&rendered), Some(record));
}

#[test]
fn record_from_a_release_before_file_lists_has_no_files() {
    assert_eq!(
        CompletionRecord::parse("42"),
        Some(CompletionRecord {
            bundle_build: 42,
            files: None,
        })
    );
}

#[test]
fn truncated_or_malformed_records_are_rejected() {
    for contents in [
        "",
        "not-a-build",
        "42\n",
        "42\nfiles 2\n120 index.html",
        "42\nfiles 2\n120 index.html\n",
        "42\nfiles 1\n120 index.html\n7 extra.js\n",
        "42\nfiles 1\n120\n",
        "42\nfiles 1\nabc index.html\n",
        "42\nfiles x\n",
        "42\n120 index.html\n",
    ] {
        assert_eq!(CompletionRecord::parse(contents), None, "{contents:?}");
    }
}

#[test]
fn file_names_that_break_the_line_format_are_refused() {
    let result = CompletionRecord::new(
        42,
        vec![BundleFile {
            path: PathBuf::from("assets/a\nb.js"),
            size: 1,
        }],
    );

    assert!(result.is_err());
}
