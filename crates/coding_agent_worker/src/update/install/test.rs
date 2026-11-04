use super::*;

/// A release archive the way the workflow packs one: `tar -czf` of one file.
fn archive_with(name: &str, contents: &[u8]) -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::default(),
    ));
    let mut header = tar::Header::new_gnu();
    header.set_size(contents.len() as u64);
    header.set_mode(0o755);
    header.set_cksum();
    builder.append_data(&mut header, name, contents).unwrap();
    builder.into_inner().unwrap().finish().unwrap()
}

fn checksum_file(archive: &[u8], name: &str) -> String {
    format!("{}  {name}\n", hex::encode(Sha256::digest(archive)))
}

#[test]
fn stages_the_verified_binary_next_to_the_executable() {
    let directory = tempfile::tempdir().unwrap();
    let installation = Installation::at(directory.path().join("macrod"));
    let archive = archive_with("macrod", b"new macrod");

    let staged = installation
        .stage(
            &archive,
            &checksum_file(&archive, "macrod-v2026.10.27.2-linux-x86_64.tar.gz"),
            "v2026.10.27.2",
        )
        .unwrap();

    assert_eq!(staged, directory.path().join(".macrod.new"));
    assert_eq!(std::fs::read(&staged).unwrap(), b"new macrod");
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = std::fs::metadata(&staged).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
    }
}

#[test]
fn restaging_replaces_an_earlier_staged_binary() {
    let directory = tempfile::tempdir().unwrap();
    let installation = Installation::at(directory.path().join("macrod"));
    std::fs::write(
        directory.path().join(".macrod.new"),
        b"interrupted download",
    )
    .unwrap();
    let archive = archive_with("macrod", b"new macrod");

    let staged = installation
        .stage(
            &archive,
            &checksum_file(&archive, "macrod.tar.gz"),
            "v2026.10.27.2",
        )
        .unwrap();

    assert_eq!(std::fs::read(staged).unwrap(), b"new macrod");
}

#[test]
fn a_checksum_mismatch_stages_nothing() {
    let directory = tempfile::tempdir().unwrap();
    let installation = Installation::at(directory.path().join("macrod"));
    let archive = archive_with("macrod", b"new macrod");
    let other = archive_with("macrod", b"tampered macrod");

    let error = installation
        .stage(
            &archive,
            &checksum_file(&other, "macrod.tar.gz"),
            "v2026.10.27.2",
        )
        .unwrap_err();

    assert!(
        matches!(error, StageError::ChecksumMismatch { .. }),
        "{error:?}"
    );
    assert!(!directory.path().join(".macrod.new").exists());
}

#[test]
fn a_checksum_file_without_a_digest_is_rejected() {
    let directory = tempfile::tempdir().unwrap();
    let installation = Installation::at(directory.path().join("macrod"));
    let archive = archive_with("macrod", b"new macrod");

    for checksum in ["", "Not Found", "abc123  macrod.tar.gz"] {
        let error = installation
            .stage(&archive, checksum, "v2026.10.27.2")
            .unwrap_err();
        assert!(
            matches!(error, StageError::MalformedChecksum),
            "{checksum:?}: {error:?}"
        );
    }
}

#[test]
fn an_archive_without_the_binary_stages_nothing() {
    let directory = tempfile::tempdir().unwrap();
    let installation = Installation::at(directory.path().join("macrod"));
    let archive = archive_with("README.md", b"not a binary");

    let error = installation
        .stage(
            &archive,
            &checksum_file(&archive, "macrod.tar.gz"),
            "v2026.10.27.2",
        )
        .unwrap_err();

    assert!(matches!(error, StageError::MissingExecutable), "{error:?}");
    assert!(!directory.path().join(".macrod.new").exists());
}

#[test]
fn swapping_replaces_the_executable_and_leaves_nothing_staged() {
    let directory = tempfile::tempdir().unwrap();
    let executable = directory.path().join("macrod");
    std::fs::write(&executable, b"old macrod").unwrap();
    let installation = Installation::at(executable.clone());
    let archive = archive_with("macrod", b"new macrod");
    let staged = installation
        .stage(
            &archive,
            &checksum_file(&archive, "macrod.tar.gz"),
            "v2026.10.27.2",
        )
        .unwrap();
    // A process running the old binary holds it open across the swap.
    let running = std::fs::File::open(&executable).unwrap();

    installation.swap(&staged).unwrap();

    assert_eq!(std::fs::read(&executable).unwrap(), b"new macrod");
    assert!(!staged.exists());
    let mut still_running = Vec::new();
    std::io::Read::read_to_end(&mut &running, &mut still_running).unwrap();
    assert_eq!(still_running, b"old macrod");
}

#[test]
fn leftovers_from_an_earlier_run_are_removed() {
    let directory = tempfile::tempdir().unwrap();
    let executable = directory.path().join("macrod");
    std::fs::write(&executable, b"macrod").unwrap();
    std::fs::write(directory.path().join(".macrod.new"), b"never swapped").unwrap();
    let installation = Installation::at(executable.clone());

    installation.remove_leftovers();

    assert!(!directory.path().join(".macrod.new").exists());
    assert_eq!(std::fs::read(executable).unwrap(), b"macrod");
}
