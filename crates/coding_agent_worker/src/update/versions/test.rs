use super::*;

fn install_version(versions: &Path, tag: &str) {
    let folder = versions.join(tag);
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join(CORE_EXECUTABLE), tag).unwrap();
}

#[test]
fn the_launcher_picks_the_newest_complete_version() {
    let root = tempfile::tempdir().unwrap();
    let versions = Versions::new(root.path().join(VERSIONS_DIRECTORY));
    install_version(versions.directory(), "v2026.10.9.3");
    install_version(versions.directory(), "v2026.10.10.1");
    install_version(versions.directory(), "v2026.10.10.0");
    // Still being written, and not a version at all: neither is launched.
    install_version(versions.directory(), "v2026.12.1.0.partial");
    install_version(versions.directory(), "scratch");
    // A version folder without its core is not complete.
    std::fs::create_dir_all(versions.directory().join("v2026.11.1.0")).unwrap();

    let (version, core) = versions.newest().unwrap();

    assert_eq!(Some(version), ReleaseVersion::parse("v2026.10.10.1"));
    assert_eq!(
        core,
        versions
            .directory()
            .join("v2026.10.10.1")
            .join(CORE_EXECUTABLE)
    );
}

#[test]
fn no_versions_means_no_launcher() {
    let root = tempfile::tempdir().unwrap();
    assert!(
        Versions::new(root.path().join(VERSIONS_DIRECTORY))
            .newest()
            .is_none()
    );
}

#[test]
fn pruning_keeps_the_launched_version_and_any_being_staged() {
    let root = tempfile::tempdir().unwrap();
    let versions = Versions::new(root.path().join(VERSIONS_DIRECTORY));
    install_version(versions.directory(), "v2026.10.9.3");
    install_version(versions.directory(), "v2026.10.10.1");
    install_version(versions.directory(), "v2026.10.11.0.partial");
    install_version(versions.directory(), "scratch");

    versions.prune(ReleaseVersion::parse("v2026.10.10.1").unwrap());

    let mut left: Vec<_> = std::fs::read_dir(versions.directory())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    left.sort();
    // A running macrod may be writing the partial version right now.
    assert_eq!(left, ["scratch", "v2026.10.10.1", "v2026.10.11.0.partial"]);
}

#[test]
fn a_staged_version_is_launchable_only_once_committed() {
    let root = tempfile::tempdir().unwrap();
    let versions = Versions::new(root.path().join(VERSIONS_DIRECTORY));
    install_version(versions.directory(), "v2026.10.9.3");
    let staged = versions.staging_executable("v2026.10.10.1");
    std::fs::create_dir_all(staged.parent().unwrap()).unwrap();
    std::fs::write(&staged, "new").unwrap();

    assert_eq!(
        versions.newest().map(|(version, _)| version),
        ReleaseVersion::parse("v2026.10.9.3")
    );
    let core = versions.commit("v2026.10.10.1").unwrap();

    assert_eq!(std::fs::read_to_string(&core).unwrap(), "new");
    assert_eq!(versions.newest().map(|(_, path)| path), Some(core));
}

#[test]
fn a_core_finds_its_installation_and_a_plain_binary_starts_one() {
    let core = Path::new("/apps/macrod")
        .join(VERSIONS_DIRECTORY)
        .join("v2026.10.10.1")
        .join(CORE_EXECUTABLE);
    assert_eq!(
        Versions::of_executable(&core).directory(),
        Path::new("/apps/macrod").join(VERSIONS_DIRECTORY)
    );

    let plain = Path::new("/apps/macrod/macrod.exe");
    assert_eq!(
        Versions::of_executable(plain).directory(),
        Path::new("/apps/macrod").join(VERSIONS_DIRECTORY)
    );
}
