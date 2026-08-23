use super::*;

fn scratch(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "macro-binaries-{}-{}-{name}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn adoption_is_unchanged_for_the_same_path() {
    let root = scratch("same");
    let set = BinariesDir::TargetDir(root.clone());
    assert_eq!(set.adoption_from(&root), Adoption::Unchanged);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn adoption_is_remount_when_the_host_dir_changes() {
    let a = PathBuf::from("/tmp/macro-binaries-a");
    let b = PathBuf::from("/tmp/macro-binaries-b");
    let set = BinariesDir::TargetDir(a);
    assert_eq!(set.adoption_from(&b), Adoption::Remount);
}

#[test]
fn missing_record_is_a_remount() {
    let set = BinariesDir::TargetDir(PathBuf::from("/tmp/macro-binaries-recorded"));
    assert_eq!(set.adoption_from_recorded(None), Adoption::Remount);
    assert_eq!(
        set.adoption_from_recorded(Some(Path::new("/tmp/macro-binaries-recorded"))),
        Adoption::Unchanged
    );
}

#[test]
fn classify_rejects_a_missing_dir() {
    let err = BinariesDir::classify(Path::new("/tmp/macro-does-not-exist-binaries"))
        .expect_err("missing dir");
    assert!(err.to_string().contains("does not exist"));
}

#[test]
fn target_dir_pin_is_a_noop() {
    let root = scratch("target-pin");
    let set = BinariesDir::TargetDir(root.join("bins"));
    set.pin_gc_root(&root.join("roots")).unwrap();
    assert!(!root.join("roots").join("nix-binaries").exists());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn nix_pin_falls_back_to_a_symlink_and_releases_the_previous() {
    let root = scratch("nix-pin");
    let first = root.join("out-a");
    let second = root.join("out-b");
    std::fs::create_dir_all(first.join("bin")).unwrap();
    std::fs::create_dir_all(second.join("bin")).unwrap();
    let roots = root.join("roots");

    let a = BinariesDir::NixStore(first.join("bin"));
    a.pin_gc_root(&roots).unwrap();
    let pin = roots.join("nix-binaries");
    assert!(pin.exists());
    assert_eq!(canonicalize_or_clone(&pin), canonicalize_or_clone(&first));
    assert!(!roots.join("nix-binaries.prev").exists());

    a.pin_gc_root(&roots).unwrap();
    assert!(!roots.join("nix-binaries.prev").exists());

    let b = BinariesDir::NixStore(second.join("bin"));
    b.pin_gc_root(&roots).unwrap();
    assert!(roots.join("nix-binaries.prev").exists());
    assert_eq!(
        canonicalize_or_clone(&roots.join("nix-binaries")),
        canonicalize_or_clone(&second)
    );

    BinariesDir::release_previous_gc_root(&roots);
    assert!(!roots.join("nix-binaries.prev").exists());
    let _ = std::fs::remove_dir_all(&root);
}
