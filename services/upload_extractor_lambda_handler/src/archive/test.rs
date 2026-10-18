use super::*;
use std::io::Write;
use zip::{ZipWriter, write::SimpleFileOptions};

#[test]
fn ordinary_upload_preserves_nested_file_contents() {
    let temp = tempfile::tempdir().unwrap();
    let archive = temp.path().join("upload.zip");
    let mut zip = ZipWriter::new(fs::File::create(&archive).unwrap());
    zip.add_directory("Folder/", SimpleFileOptions::default())
        .unwrap();
    zip.start_file("Folder/Nested/report.txt", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"customer document").unwrap();
    zip.finish().unwrap();

    let output = temp.path().join("extracted");
    assert_eq!(extract_zip_file(&archive, &output, None).unwrap(), "Folder");
    assert_eq!(
        fs::read(output.join("Folder/Nested/report.txt")).unwrap(),
        b"customer document"
    );
}

#[cfg(unix)]
#[test]
fn extraction_rejects_escaping_symlinks_without_touching_the_target() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let outside = temp.path().join("outside.txt");
    fs::write(&outside, b"unchanged").unwrap();
    fs::set_permissions(&outside, fs::Permissions::from_mode(0o600)).unwrap();
    let archive = temp.path().join("upload.zip");
    let mut zip = ZipWriter::new(fs::File::create(&archive).unwrap());
    zip.add_directory("Folder/", SimpleFileOptions::default())
        .unwrap();
    zip.add_symlink(
        "Folder/escape",
        outside.to_str().unwrap(),
        SimpleFileOptions::default().unix_permissions(0o777),
    )
    .unwrap();
    zip.finish().unwrap();

    let output = temp.path().join("extracted");
    assert!(extract_zip_file(&archive, &output, None).is_err());
    assert!(fs::symlink_metadata(output.join("Folder/escape")).is_err());
    assert_eq!(fs::read(&outside).unwrap(), b"unchanged");
    assert_eq!(
        fs::metadata(&outside).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[cfg(unix)]
#[test]
fn extraction_strips_privileged_permission_bits() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let archive = temp.path().join("upload.zip");
    let mut zip = ZipWriter::new(fs::File::create(&archive).unwrap());
    zip.start_file("Folder/report.txt", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"customer document").unwrap();
    zip.finish().unwrap();

    // Writers mask these bits themselves. Modify the actual archive metadata
    // to exercise extraction of an attacker-supplied Unix permission field.
    let mut bytes = fs::read(&archive).unwrap();
    let central = bytes
        .windows(4)
        .position(|window| window == b"PK\x01\x02")
        .unwrap();
    bytes[central + 5] = 3; // Unix 'version made by' system.
    let attributes = (0o100000u32 | 0o6755) << 16;
    bytes[central + 38..central + 42].copy_from_slice(&attributes.to_le_bytes());
    assert_eq!(
        u32::from_le_bytes(bytes[central + 38..central + 42].try_into().unwrap()) >> 16 & 0o7000,
        0o6000
    );
    fs::write(&archive, bytes).unwrap();

    let output = temp.path().join("extracted");
    assert_eq!(extract_zip_file(&archive, &output, None).unwrap(), "Folder");
    let extracted = output.join("Folder/report.txt");
    assert_eq!(fs::read(&extracted).unwrap(), b"customer document");
    assert_eq!(
        fs::metadata(&extracted).unwrap().permissions().mode() & 0o7777,
        0o755
    );
}
