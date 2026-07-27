use super::*;

#[test]
fn discovers_repository_root_from_nested_directory() {
    let root = repo_root();
    let nested = root.join("tooling/xtask/crates/xtask_paths");

    assert_eq!(find_repo_root_from(&nested), Some(root));
}

#[test]
fn typed_paths_validate_against_the_repository() {
    let root = repo_root();
    repo_file!("Cargo.toml").validate_at(&root).unwrap();
    repo_dir!("apps/web").validate_at(&root).unwrap();
    repo_glob!("services/**/Cargo.toml")
        .validate_at(&root)
        .unwrap();
    repo_glob!(".github/actions/setup-cachix/**/*")
        .validate_at(&root)
        .unwrap();
    assert_eq!(runtime_path!("artifacts/*").as_str(), "artifacts/*");
}

#[test]
fn dynamic_paths_reject_unsafe_syntax() {
    assert!(RepoFile::try_new("../Cargo.toml").is_err());
    assert!(RepoDir::try_new("/apps/web").is_err());
    assert!(RepoGlob::try_new("services\\**").is_err());
    assert!(RepoFile::try_new("Cargo.*").is_err());
}

#[test]
fn missing_paths_are_reported_by_kind() {
    let root = repo_root();
    let file_error = RepoFile::try_new("definitely-missing.txt")
        .unwrap()
        .validate_at(&root)
        .unwrap_err();
    let glob_error = RepoGlob::try_new("definitely-missing/**")
        .unwrap()
        .validate_at(&root)
        .unwrap_err();
    assert!(file_error.to_string().contains("repository file"));
    assert!(glob_error.to_string().contains("matches no paths"));
}
