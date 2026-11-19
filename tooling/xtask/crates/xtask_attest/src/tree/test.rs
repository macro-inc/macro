use std::path::Path;

use super::*;

fn paths(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

fn commit(dir: &Path, message: &str) -> String {
    git(dir, &["add", "-A"]).expect("git add");
    git(
        dir,
        &[
            "-c",
            "user.name=test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            message,
        ],
    )
    .expect("git commit");
    git(dir, &["rev-parse", "HEAD"]).expect("a commit")
}

fn repository() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().expect("a directory");
    git(dir.path(), &["init", "--quiet"]).expect("git init");
    std::fs::create_dir_all(dir.path().join("crates/a")).expect("a directory");
    std::fs::write(dir.path().join("crates/a/lib.rs"), "one").expect("a file");
    std::fs::write(dir.path().join("README.md"), "docs").expect("a file");
    let first = commit(dir.path(), "first");
    (dir, first)
}

#[test]
fn any_change_to_a_file_is_another_tree() {
    let (dir, first) = repository();
    std::fs::write(dir.path().join("README.md"), "other docs").expect("a file");
    let second = commit(dir.path(), "docs");

    assert_ne!(
        tree_of(dir.path(), &first).expect("a tree"),
        tree_of(dir.path(), &second).expect("a tree")
    );
}

#[test]
fn a_commit_that_changes_no_file_keeps_the_tree() {
    let (dir, first) = repository();
    let reworded = commit(dir.path(), "nothing changed");
    let again = commit(dir.path(), "still nothing");
    std::fs::write(dir.path().join("README.md"), "other docs").expect("a file");
    let changed = commit(dir.path(), "docs");

    assert_eq!(
        tree_of(dir.path(), &first).expect("a tree"),
        tree_of(dir.path(), &again).expect("a tree")
    );
    assert_eq!(
        same_tree_before(dir.path(), &again, 5).expect("commits"),
        vec![reworded.clone(), first.clone()]
    );
    assert_eq!(
        same_tree_before(dir.path(), &again, 1).expect("commits"),
        vec![reworded]
    );
    assert!(
        same_tree_before(dir.path(), &changed, 5)
            .expect("commits")
            .is_empty()
    );
    assert!(
        same_tree_before(dir.path(), &first, 5)
            .expect("commits")
            .is_empty()
    );
}

#[test]
fn reports_changed_and_new_files_anywhere() {
    let (dir, _) = repository();
    assert!(uncommitted(dir.path()).expect("status").is_empty());

    std::fs::write(dir.path().join("README.md"), "edited").expect("a file");
    std::fs::write(dir.path().join("crates/a/new.rs"), "new").expect("a file");

    assert_eq!(uncommitted(dir.path()).expect("status").len(), 2);
}

#[test]
fn tells_whether_a_branch_changed_what_triggers_a_check() {
    let (dir, first) = repository();
    std::fs::write(dir.path().join("README.md"), "other docs").expect("a file");
    let second = commit(dir.path(), "docs");

    let differs = |triggers: &[&str]| {
        differs_under(dir.path(), &first, &second, &paths(triggers)).expect("git diff")
    };

    assert!(!differs(&["crates", "Cargo.lock"]));
    assert!(differs(&["README.md"]));
    assert!(differs(&["."]));
}
