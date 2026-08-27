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
fn nix_pin_fails_when_out_link_cannot_register() {
    let root = scratch("nix-pin-fail");
    let out = root.join("out-a");
    std::fs::create_dir_all(out.join("bin")).unwrap();
    let err = BinariesDir::NixStore(out.join("bin"))
        .pin_gc_root(&root.join("roots"))
        .expect_err("nix build --out-link must register a real GC root");
    let msg = format!("{err:#}");
    assert!(
        msg.contains("nix build --out-link"),
        "unexpected pin error: {msg}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn release_previous_gc_root_deletes_the_prev_link() {
    let root = scratch("release-prev");
    let prev = root.join("nix-binaries.prev");
    std::fs::write(&prev, "").unwrap();
    BinariesDir::release_previous_gc_root(&root);
    assert!(!prev.exists());
    let _ = std::fs::remove_dir_all(&root);
}
