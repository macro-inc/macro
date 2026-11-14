use std::io::Write as _;

use super::*;

fn lines(batch: &Batch) -> Vec<&str> {
    batch
        .lines()
        .map(|line| std::str::from_utf8(line).expect("utf-8"))
        .collect()
}

fn append(path: &Path, text: &str) {
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(path)
        .expect("open");
    file.write_all(text.as_bytes()).expect("write");
}

#[test]
fn reads_complete_lines_and_keeps_an_unfinished_last_line_for_later() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("t.jsonl");
    append(&path, "{\"a\":1}\n{\"b\":");
    let mut tail = Tail::default();

    let first = tail.read(&path).expect("read");
    assert!(first.from_start);
    assert_eq!(lines(&first), ["{\"a\":1}"]);
    assert_eq!(tail.offset(), 8);

    append(&path, "2}\n");
    let second = tail.read(&path).expect("read");
    assert!(!second.from_start);
    assert_eq!(lines(&second), ["{\"b\":2}"]);

    let idle = tail.read(&path).expect("read");
    assert!(idle.bytes.is_empty());
}

#[test]
fn a_truncated_file_is_read_again_from_the_start() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("t.jsonl");
    append(&path, "one\ntwo\n");
    let mut tail = Tail::default();
    tail.read(&path).expect("read");

    std::fs::write(&path, "x\n").expect("truncate");
    let batch = tail.read(&path).expect("read");

    assert!(batch.from_start);
    assert_eq!(lines(&batch), ["x"]);
}

#[test]
fn a_replaced_file_is_read_again_from_the_start() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("t.jsonl");
    append(&path, "one\n");
    let mut tail = Tail::default();
    tail.read(&path).expect("read");

    let replacement = dir.path().join("new.jsonl");
    std::fs::write(&replacement, "uno\ndos\n").expect("write");
    std::fs::rename(&replacement, &path).expect("rename");
    let batch = tail.read(&path).expect("read");

    assert!(batch.from_start);
    assert_eq!(lines(&batch), ["uno", "dos"]);
}

#[test]
fn stale_only_when_the_file_grew_shrank_or_was_replaced() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("t.jsonl");
    append(&path, "one\n");
    let mut tail = Tail::default();
    tail.read(&path).expect("read");

    assert!(!tail.position().is_stale(&std::fs::metadata(&path).expect("stat")));
    append(&path, "two\n");
    assert!(tail.position().is_stale(&std::fs::metadata(&path).expect("stat")));
}

#[test]
fn a_line_longer_than_a_batch_is_skipped_and_reading_continues_after_it() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("t.jsonl");
    let huge = "x".repeat(usize::try_from(MAX_BATCH).expect("fits") + 10);
    append(&path, &format!("{huge}\nafter\n"));
    let mut tail = Tail::default();

    let mut seen = Vec::new();
    loop {
        let batch = tail.read(&path).expect("read");
        seen.extend(lines(&batch).into_iter().map(str::to_owned));
        if !batch.more {
            break;
        }
    }

    assert_eq!(seen, ["after"]);
}
