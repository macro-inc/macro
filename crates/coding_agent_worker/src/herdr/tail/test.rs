use super::*;
use std::io::Write as _;

#[test]
fn partial_utf8_and_missing_newlines_are_not_consumed() {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    file.write_all(b"first\n\xc3").unwrap();
    let mut cursor = Cursor::default();
    assert_eq!(cursor.read(file.path()).unwrap(), ["first"]);
    assert_eq!(cursor.offset, 6);
    assert!(cursor.read(file.path()).unwrap().is_empty());
    file.write_all(b"\xa9\nlast").unwrap();
    assert_eq!(cursor.read(file.path()).unwrap(), ["é"]);
    file.write_all(b"\n").unwrap();
    assert_eq!(cursor.read(file.path()).unwrap(), ["last"]);
    assert!(cursor.read(file.path()).unwrap().is_empty());
}

#[test]
fn truncation_and_replacement_require_explicit_replay() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("log");
    std::fs::write(&path, "one\n").unwrap();
    let mut cursor = Cursor::default();
    cursor.read(&path).unwrap();
    std::fs::write(&path, "").unwrap();
    assert!(cursor.read(&path).is_err());
    std::fs::write(&path, "one\n").unwrap();
    let replacement = root.path().join("replacement");
    std::fs::write(&replacement, "two\n").unwrap();
    std::fs::rename(replacement, &path).unwrap();
    assert!(cursor.read(&path).is_err());
}
