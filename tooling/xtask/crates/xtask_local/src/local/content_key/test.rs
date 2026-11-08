use super::*;

fn entry_with(root: &Path, name: &str, marker: &str) -> PathBuf {
    let dir = root.join(name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("marker"), marker).unwrap();
    dir
}

fn complete(dir: &Path) -> bool {
    dir.join("marker").exists()
}

/// Another checkout may install the same key at the same time and be reading
/// it: a complete entry is never replaced, an incomplete leftover is.
#[test]
fn install_entry_keeps_a_complete_entry_and_replaces_a_partial_one() {
    let root = std::env::temp_dir().join(format!("content-key-install-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let entry = root.join("key");

    let first = entry_with(&root, ".tmp-first", "first");
    install_entry(&first, &entry, complete).unwrap();
    assert_eq!(
        std::fs::read_to_string(entry.join("marker")).unwrap(),
        "first"
    );

    let second = entry_with(&root, ".tmp-second", "second");
    install_entry(&second, &entry, complete).unwrap();
    assert_eq!(
        std::fs::read_to_string(entry.join("marker")).unwrap(),
        "first",
        "a complete entry stays"
    );
    assert!(!second.exists(), "the losing copy is dropped");

    std::fs::remove_file(entry.join("marker")).unwrap();
    std::fs::write(entry.join("half-written"), "x").unwrap();
    let third = entry_with(&root, ".tmp-third", "third");
    install_entry(&third, &entry, complete).unwrap();
    assert_eq!(
        std::fs::read_to_string(entry.join("marker")).unwrap(),
        "third"
    );
    assert!(
        !entry.join("half-written").exists(),
        "a partial entry is replaced"
    );

    std::fs::remove_dir_all(&root).unwrap();
}
