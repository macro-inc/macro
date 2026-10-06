use super::*;
use std::{fs, process::Command};

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[tokio::test]
async fn captures_real_git_renames_untracked_binary_and_full_contents() {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "-q"]);
    fs::write(
        root.path().join("old.rs"),
        "fn main() {\n    println!(\"🐺\");\n}\n",
    )
    .unwrap();
    git(root.path(), &["add", "."]);
    git(
        root.path(),
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-qm",
            "base",
        ],
    );
    git(root.path(), &["mv", "old.rs", "new.rs"]);
    fs::write(root.path().join("extra.ts"), "export const answer = 42;\n").unwrap();
    fs::write(root.path().join("image.bin"), [0, 1, 2]).unwrap();
    let capture = WorkspaceCapture::new(root.path().into())
        .capture(root.path().into(), Comparison::default())
        .await
        .unwrap();
    assert_eq!(capture.snapshot.files.len(), 3);
    let renamed = capture
        .snapshot
        .files
        .iter()
        .find(|f| f.path == "new.rs")
        .unwrap();
    assert_eq!(renamed.old_path.as_deref(), Some("old.rs"));
    assert!(renamed.new.as_ref().unwrap().lines[1].contains('🐺'));
    assert!(
        capture
            .snapshot
            .files
            .iter()
            .find(|f| f.path == "image.bin")
            .unwrap()
            .omitted
            .is_some()
    );
    assert_eq!(capture.comparison.base.unwrap().len(), 40);
    assert!(capture.comparison.head.is_none());
}

#[tokio::test]
async fn refuses_a_workspace_outside_the_configured_root() {
    let root = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let error = WorkspaceCapture::new(root.path().into())
        .capture(other.path().into(), Comparison::default())
        .await
        .unwrap_err();
    assert!(error.contains("outside"));
}

#[tokio::test]
async fn files_over_budget_are_explicit_and_unborn_repositories_work() {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "-q"]);
    let huge = fs::File::create(root.path().join("huge.txt")).unwrap();
    huge.set_len(domain::ports::MAX_FILE_BYTES + 1).unwrap();
    fs::write(root.path().join("empty.txt"), "").unwrap();
    let capture = WorkspaceCapture::new(root.path().into())
        .capture(root.path().into(), Comparison::default())
        .await
        .unwrap();
    let huge = capture
        .snapshot
        .files
        .iter()
        .find(|f| f.path == "huge.txt")
        .unwrap();
    assert_eq!(huge.omitted, Some(diffd_core::model::Omitted::TooLarge));
    assert!(huge.rows.is_empty());
    assert_eq!(capture.snapshot.files.len(), 2);
}

#[test]
fn large_source_has_complete_line_alignment() {
    let text = (0..100_000)
        .map(|line| format!("line {line}\n"))
        .collect::<String>();
    let snapshot = build(vec![diffd_core::build::FileInput {
        path: "large.txt".into(),
        old_path: None,
        status: diffd_core::model::FileStatus::Added,
        old: None,
        new: Some(text),
        omitted: None,
        details: vec![],
        collapsed: None,
    }])
    .unwrap();
    assert_eq!(snapshot.files[0].new.as_ref().unwrap().lines.len(), 100_000);
    assert_eq!(snapshot.files[0].rows.last().unwrap().1, Some(99_999));
}

#[test]
fn cached_definitions_follow_the_current_file_order() {
    fn input(path: &str) -> diffd_core::build::FileInput {
        diffd_core::build::FileInput {
            path: path.into(),
            old_path: None,
            status: diffd_core::model::FileStatus::Added,
            old: None,
            new: Some("fn hello() {}\n".into()),
            omitted: None,
            details: vec![],
            collapsed: None,
        }
    }
    let mut cache = build::CaptureCache::default();
    let first = build::build_cached(vec![input("a.rs"), input("b.rs")], &mut cache).unwrap();
    let next = build::build_cached(vec![input("b.rs"), input("a.rs")], &mut cache).unwrap();
    assert_eq!(first.files[0], next.files[1]);
    assert!(
        next.symbols
            .iter()
            .any(|s| s.file == 0 && s.name == "hello")
    );
    assert!(
        next.symbols
            .iter()
            .any(|s| s.file == 1 && s.name == "hello")
    );
}

#[test]
fn dense_short_lines_are_omitted_before_expanding_rows() {
    let file = diffd_core::build::FileInput {
        path: "dense.txt".into(),
        old_path: None,
        status: diffd_core::model::FileStatus::Added,
        old: None,
        new: Some("\n".repeat(8 * 1024 * 1024)),
        omitted: None,
        details: vec![],
        collapsed: None,
    };
    let capture = build(vec![file]).unwrap();
    assert_eq!(capture.files.len(), 1);
    assert_eq!(
        capture.files[0].omitted,
        Some(diffd_core::model::Omitted::TooLarge)
    );
    assert!(capture.files[0].rows.is_empty());
    assert!(capture.files[0].new.is_none());
}

#[test]
fn plain_text_and_whitespace_changes_keep_complete_bounded_alignment() {
    let files = [
        (
            "notes.txt",
            "old sentence\nsecond line\n",
            "new sentence\nsecond line\n",
        ),
        (
            "main.rs",
            "fn main() {\n    hello();\n}\n",
            "fn main() {\n        hello();\n}\n",
        ),
    ]
    .into_iter()
    .map(|(path, old, new)| diffd_core::build::FileInput {
        path: path.into(),
        old_path: None,
        status: diffd_core::model::FileStatus::Modified,
        old: Some(old.into()),
        new: Some(new.into()),
        omitted: None,
        details: vec![],
        collapsed: None,
    })
    .collect();
    let capture = build(files).unwrap();
    assert_eq!(
        capture.files[0].new.as_ref().unwrap().lines[0],
        "new sentence"
    );
    assert_eq!(
        capture.files[1].new.as_ref().unwrap().lines[1],
        "        hello();"
    );
    for file in capture.files {
        assert!(!file.rows.is_empty());
        assert!(file.added > 0 && file.removed > 0);
    }
}

#[test]
fn sparse_edits_in_one_hundred_thousand_lines_do_not_mark_equal_rows_changed() {
    let old = (0..100_000)
        .map(|i| format!("const v{i} = {i};\n"))
        .collect::<String>();
    let new = old
        .replace("v100 = 100;", "v100 = 101;")
        .replace("v50000 = 50000;", "v50000 = 50001;")
        .replace("v99999 = 99999;", "v99999 = 100000;");
    let snapshot = build(vec![diffd_core::build::FileInput {
        path: "large.ts".into(),
        old_path: None,
        status: diffd_core::model::FileStatus::Modified,
        old: Some(old),
        new: Some(new),
        omitted: None,
        details: vec![],
        collapsed: None,
    }])
    .unwrap();
    assert_eq!(snapshot.files[0].new.as_ref().unwrap().lines.len(), 100_000);
    assert_eq!(snapshot.files[0].added, 3);
    assert_eq!(snapshot.files[0].removed, 3);
}
