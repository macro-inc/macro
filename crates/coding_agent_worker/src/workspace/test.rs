use std::path::{Path, PathBuf};

use harnesses::domain::models::{ReportedWorkspace, ReportedWorkspaceKind};

use super::{AllowedRoots, WorkspaceRefusal, WorkspaceSource, requested_workspace};

#[test]
fn the_agent_workspace_wins_then_the_runtime_then_the_local_one() {
    let local = Path::new("/home/me/code");

    assert_eq!(
        requested_workspace(Some("/home/me/code/api"), Some("/home/me/code/web"), local),
        (PathBuf::from("/home/me/code/api"), WorkspaceSource::Agent)
    );
    assert_eq!(
        requested_workspace(None, Some("/home/me/code/web"), local),
        (PathBuf::from("/home/me/code/web"), WorkspaceSource::Runtime)
    );
    assert_eq!(
        requested_workspace(None, None, local),
        (PathBuf::from("/home/me/code"), WorkspaceSource::Local)
    );
}

#[test]
fn a_directory_inside_an_allowed_root_is_admitted_canonical() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("code");
    std::fs::create_dir_all(root.join("api")).unwrap();
    let roots = AllowedRoots::resolve(std::slice::from_ref(&root));

    let admitted = roots
        .admit(&root.join("api").join("..").join("api"))
        .unwrap();

    assert_eq!(admitted, root.join("api").canonicalize().unwrap());
    assert_eq!(roots.admit(&root).unwrap(), root.canonicalize().unwrap());
}

#[test]
fn dot_dot_cannot_climb_out_of_an_allowed_root() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("code");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(directory.path().join("secrets")).unwrap();
    let roots = AllowedRoots::resolve(std::slice::from_ref(&root));

    let refused = roots.admit(&root.join("..").join("secrets"));

    assert!(
        matches!(refused, Err(WorkspaceRefusal::OutsideAllowedRoots { .. })),
        "{refused:?}"
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_cannot_lead_out_of_an_allowed_root() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("code");
    let outside = directory.path().join("secrets");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
    let roots = AllowedRoots::resolve(std::slice::from_ref(&root));

    let refused = roots.admit(&root.join("escape"));

    assert!(
        matches!(refused, Err(WorkspaceRefusal::OutsideAllowedRoots { .. })),
        "{refused:?}"
    );
}

#[test]
fn a_sibling_sharing_a_prefix_is_outside_the_root() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("code");
    let sibling = directory.path().join("code-private");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&sibling).unwrap();
    let roots = AllowedRoots::resolve(std::slice::from_ref(&root));

    assert!(matches!(
        roots.admit(&sibling),
        Err(WorkspaceRefusal::OutsideAllowedRoots { .. })
    ));
}

#[test]
fn a_missing_directory_or_a_file_is_refused() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().to_owned();
    std::fs::write(root.join("notes.txt"), "notes").unwrap();
    let roots = AllowedRoots::resolve(std::slice::from_ref(&root));

    assert!(matches!(
        roots.admit(&root.join("gone")),
        Err(WorkspaceRefusal::Missing { .. })
    ));
    assert!(matches!(
        roots.admit(&root.join("notes.txt")),
        Err(WorkspaceRefusal::NotADirectory { .. })
    ));
}

#[test]
fn a_missing_root_allows_nothing() {
    let directory = tempfile::tempdir().unwrap();
    let roots = AllowedRoots::resolve(&[directory.path().join("gone")]);

    assert!(roots.roots().is_empty());
    assert!(matches!(
        roots.admit(directory.path()),
        Err(WorkspaceRefusal::OutsideAllowedRoots { .. })
    ));
}

#[test]
fn discovery_reports_roots_then_repositories_two_levels_down() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("code");
    for repository in ["api/.git", "clients/web/.git", "clients/web/nested/.git"] {
        std::fs::create_dir_all(root.join(repository)).unwrap();
    }
    for ignored in [".hidden/repo/.git", "a/b/too-deep/.git", "notes"] {
        std::fs::create_dir_all(root.join(ignored)).unwrap();
    }
    let root = root.canonicalize().unwrap();
    let roots = AllowedRoots::resolve(std::slice::from_ref(&root));

    let path = |path: PathBuf| path.to_str().unwrap().to_owned();
    assert_eq!(
        roots.discover(),
        [
            ReportedWorkspace {
                path: path(root.clone()),
                kind: ReportedWorkspaceKind::AllowedRoot,
            },
            ReportedWorkspace {
                path: path(root.join("api")),
                kind: ReportedWorkspaceKind::Repository,
            },
            ReportedWorkspace {
                path: path(root.join("clients").join("web")),
                kind: ReportedWorkspaceKind::Repository,
            },
        ]
    );
}
