use std::io::Write as _;

use super::*;

#[test]
fn the_saved_log_sits_beside_its_config() {
    assert_eq!(
        LogBuffer::path_for(Path::new("/home/me/.macrod/macrod.toml")),
        Path::new("/home/me/.macrod/logs/macrod.log")
    );
    assert_eq!(
        LogBuffer::path_for(Path::new("/home/me/.macrod/server/macrod.toml")),
        Path::new("/home/me/.macrod/server/logs/macrod.log")
    );
    assert_eq!(
        LogBuffer::path_for(Path::new("desk.dev.toml")),
        Path::new("logs/desk.dev.log")
    );
}

#[test]
fn saved_lines_outlive_the_buffer() {
    let root = tempfile::tempdir().unwrap();
    let path = LogBuffer::path_for(&root.path().join("macrod.toml"));

    let mut before = LogBuffer::default();
    before.write_all(b"not saved yet\n").unwrap();
    before.save_to(path.clone());
    before.write_all(b"first\n").unwrap();
    drop(before);

    // The next process appends to the same file.
    let mut after = LogBuffer::default();
    after.save_to(path.clone());
    after.write_all(b"second\n").unwrap();

    assert_eq!(after.saved_to(), Some(path.clone()));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "first\nsecond\n");
}

#[cfg(unix)]
#[test]
fn the_saved_log_is_private_to_its_owner() {
    use std::os::unix::fs::PermissionsExt as _;

    let root = tempfile::tempdir().unwrap();
    let path = LogBuffer::path_for(&root.path().join("macrod.toml"));
    let mut logs = LogBuffer::default();
    logs.save_to(path.clone());
    logs.write_all(b"line\n").unwrap();

    let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&path), 0o600);
    assert_eq!(mode(path.parent().unwrap()), 0o700);
}

#[test]
fn a_log_that_cannot_be_saved_is_reported_once_in_the_panel() {
    let root = tempfile::tempdir().unwrap();
    // A file where the log directory would go.
    std::fs::write(root.path().join("logs"), "").unwrap();
    let mut logs = LogBuffer::default();
    logs.save_to(LogBuffer::path_for(&root.path().join("macrod.toml")));

    logs.write_all(b"one\n").unwrap();
    logs.write_all(b"two\n").unwrap();

    let lines = logs.tail(10);
    assert_eq!(lines.len(), 3, "{lines:?}");
    assert_eq!(lines[0], "one");
    assert!(
        lines[1].contains("WARN macrod: could not save logs to"),
        "{lines:?}"
    );
    assert_eq!(lines[2], "two");
}
