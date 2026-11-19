use std::path::Path;

use super::*;

fn paths(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

fn commit(dir: &Path, message: &str) {
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
            "-m",
            message,
        ],
    )
    .expect("git commit");
}

fn repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a directory");
    git(dir.path(), &["init", "--quiet"]).expect("git init");
    std::fs::create_dir_all(dir.path().join("crates/a")).expect("a directory");
    std::fs::write(dir.path().join("crates/a/lib.rs"), "one").expect("a file");
    std::fs::write(dir.path().join("Cargo.lock"), "lock").expect("a file");
    std::fs::write(dir.path().join("README.md"), "docs").expect("a file");
    commit(dir.path(), "first");
    dir
}

/// The value `ci_gate.test.ts` pins for the same paths and objects.
#[test]
fn the_hash_is_the_one_start_computes() {
    let objects = Objects::from([
        ("Cargo.lock".to_owned(), "a".repeat(40)),
        ("crates".to_owned(), "b".repeat(40)),
    ]);

    assert_eq!(
        inputs_hash(&paths(&["flake.nix", "crates", "Cargo.lock"]), &objects),
        "33252c129f983e54"
    );
}

#[test]
fn reads_an_entry_of_the_tree_listing() {
    let (_, (object, path)) =
        entry("040000 tree 0123456789abcdef\tcrates/with space").expect("an entry");

    assert_eq!(object, "0123456789abcdef");
    assert_eq!(path, "crates/with space");
    assert!(entry("not an entry").is_err());
}

#[test]
fn a_change_outside_the_inputs_leaves_the_hash_alone() {
    let dir = repository();
    let inputs = paths(&["Cargo.lock", "crates", "flake.nix"]);
    let before = inputs_hash(
        &inputs,
        &objects_at(dir.path(), "HEAD", &inputs).expect("objects"),
    );

    std::fs::write(dir.path().join("README.md"), "other docs").expect("a file");
    commit(dir.path(), "docs");
    let after_docs = inputs_hash(
        &inputs,
        &objects_at(dir.path(), "HEAD", &inputs).expect("objects"),
    );
    std::fs::write(dir.path().join("crates/a/lib.rs"), "two").expect("a file");
    commit(dir.path(), "code");
    let after_code = inputs_hash(
        &inputs,
        &objects_at(dir.path(), "HEAD", &inputs).expect("objects"),
    );

    assert_eq!(before, after_docs);
    assert_ne!(before, after_code);
}

#[test]
fn a_file_that_appears_under_an_input_changes_the_hash() {
    let dir = repository();
    let inputs = paths(&["crates", "flake.nix"]);
    let before = objects_at(dir.path(), "HEAD", &inputs).expect("objects");
    assert!(!before.contains_key("flake.nix"));

    std::fs::write(dir.path().join("flake.nix"), "{}").expect("a file");
    commit(dir.path(), "flake");
    let after = objects_at(dir.path(), "HEAD", &inputs).expect("objects");

    assert_ne!(inputs_hash(&inputs, &before), inputs_hash(&inputs, &after));
    assert_eq!(differing(&inputs, &before, &after), paths(&["flake.nix"]));
}

#[test]
fn the_whole_tree_is_one_object() {
    let dir = repository();
    let inputs = paths(&["."]);

    let objects = objects_at(dir.path(), "HEAD", &inputs).expect("objects");

    assert_eq!(
        objects["."],
        git(dir.path(), &["rev-parse", "HEAD^{tree}"]).expect("a tree")
    );
}

#[test]
fn reports_changed_and_new_files_under_the_inputs_only() {
    let dir = repository();
    let inputs = paths(&["crates", "Cargo.lock"]);
    assert!(uncommitted(dir.path(), &inputs).expect("status").is_empty());

    std::fs::write(dir.path().join("README.md"), "edited").expect("a file");
    assert!(uncommitted(dir.path(), &inputs).expect("status").is_empty());

    std::fs::write(dir.path().join("crates/a/new.rs"), "new").expect("a file");
    std::fs::write(dir.path().join("Cargo.lock"), "edited").expect("a file");
    let changed = uncommitted(dir.path(), &inputs).expect("status");

    assert_eq!(changed.len(), 2, "{changed:?}");
}
