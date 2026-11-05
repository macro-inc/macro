use super::*;

fn workspace() -> tempfile::TempDir {
    let workspace = tempfile::tempdir().expect("tempdir");
    let dist = workspace.path().join("dist");
    std::fs::create_dir_all(dist.join("scenes")).expect("mkdir");
    std::fs::create_dir_all(dist.join(".cache")).expect("mkdir");
    std::fs::write(dist.join("index.html"), "<h1>Agents</h1>").expect("write");
    std::fs::write(dist.join("theme.css"), ":root{}").expect("write");
    std::fs::write(dist.join("scenes/empty.html"), "<p>none</p>").expect("write");
    std::fs::write(dist.join(".DS_Store"), "junk").expect("write");
    std::fs::write(dist.join(".cache/state.json"), "{}").expect("write");
    workspace
}

#[test]
fn a_directory_publishes_every_file_but_dot_files_named_from_its_top() {
    let workspace = workspace();

    let files = collect(workspace.path(), Some("dist"), None).expect("collected");

    assert_eq!(
        files
            .iter()
            .map(|file| (file.path.as_str(), file.content_type))
            .collect::<Vec<_>>(),
        vec![
            ("index.html", "text/html"),
            ("scenes/empty.html", "text/html"),
            ("theme.css", "text/css"),
        ]
    );
    assert_eq!(
        files[0].sha256,
        hex::encode(Sha256::digest(b"<h1>Agents</h1>"))
    );
    assert_eq!(files[0].bytes, b"<h1>Agents</h1>");
}

#[test]
fn named_paths_publish_only_those_files() {
    let workspace = workspace();

    let files = collect(
        workspace.path(),
        Some("dist"),
        Some(&["index.html".to_owned(), "./scenes/empty.html".to_owned()]),
    )
    .expect("collected");

    assert_eq!(
        files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        vec!["index.html", "scenes/empty.html"]
    );
}

#[test]
fn a_path_that_climbs_out_of_the_artifact_is_refused() {
    let workspace = workspace();

    for path in ["../secrets.txt", "/etc/passwd", "scenes//empty.html", ""] {
        let refused = collect(workspace.path(), Some("dist"), Some(&[path.to_owned()]));
        assert!(
            matches!(refused, Err(FileError::InvalidPath(_))),
            "{path}: {refused:?}"
        );
    }
}

#[test]
fn a_directory_outside_the_workspace_is_refused() {
    let workspace = workspace();
    let elsewhere = tempfile::tempdir().expect("tempdir");
    std::fs::write(elsewhere.path().join("index.html"), "<h1>other</h1>").expect("write");

    let absolute = collect(workspace.path(), elsewhere.path().to_str(), None);
    let relative = collect(workspace.path(), Some(".."), None);

    assert!(
        matches!(absolute, Err(FileError::OutsideWorkspace(_))),
        "{absolute:?}"
    );
    assert!(
        matches!(relative, Err(FileError::OutsideWorkspace(_))),
        "{relative:?}"
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_out_of_the_workspace_is_refused() {
    let workspace = workspace();
    let elsewhere = tempfile::tempdir().expect("tempdir");
    std::fs::write(elsewhere.path().join("key.txt"), "secret").expect("write");
    std::os::unix::fs::symlink(
        elsewhere.path().join("key.txt"),
        workspace.path().join("dist/key.txt"),
    )
    .expect("symlink");

    let walked = collect(workspace.path(), Some("dist"), None);
    let named = collect(
        workspace.path(),
        Some("dist"),
        Some(&["index.html".to_owned(), "key.txt".to_owned()]),
    );

    assert!(matches!(walked, Err(FileError::OutsideWorkspace(path)) if path == "key.txt"));
    assert!(matches!(named, Err(FileError::OutsideWorkspace(path)) if path == "key.txt"));
}

#[test]
fn an_artifact_without_an_index_page_is_refused() {
    let workspace = workspace();

    let refused = collect(
        workspace.path(),
        Some("dist"),
        Some(&["theme.css".to_owned()]),
    );

    assert!(matches!(refused, Err(FileError::NoIndex)), "{refused:?}");
}

#[test]
fn a_file_type_artifacts_cannot_serve_is_refused() {
    let workspace = workspace();
    std::fs::write(workspace.path().join("dist/build.sh"), "rm -rf /").expect("write");

    let refused = collect(workspace.path(), Some("dist"), None);

    assert!(matches!(refused, Err(FileError::UnsupportedType(path)) if path == "build.sh"));
}
