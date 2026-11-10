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

/// Two checkouts install one key over an incomplete leftover, and the second
/// runs while the first is deciding what to do with it. Once an install has
/// returned, the entry it left must not change: another bring-up may already
/// be restoring from it.
#[test]
fn an_installed_entry_is_never_replaced_by_a_concurrent_install() {
    let root = std::env::temp_dir().join(format!("content-key-race-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let entry = root.join("key");
    std::fs::create_dir_all(&entry).unwrap();
    std::fs::write(entry.join("half-written"), "x").unwrap();

    let first = entry_with(&root, ".tmp-first", "first");
    let second = entry_with(&root, ".tmp-second", "second");
    let (second_go, second_go_rx) = std::sync::mpsc::channel::<()>();
    let (second_done, second_done_rx) = std::sync::mpsc::channel::<String>();

    let second_entry = entry.clone();
    let second_install = std::thread::spawn(move || {
        second_go_rx.recv().unwrap();
        install_entry(&second, &second_entry, complete).unwrap();
        let seen = std::fs::read_to_string(second_entry.join("marker")).unwrap();
        second_done.send(seen.clone()).unwrap();
        seen
    });

    // The first install's completeness check finds the leftover incomplete,
    // then gives the second install its chance to run before going on.
    let released = std::cell::Cell::new(false);
    install_entry(&first, &entry, |dir| {
        let done = complete(dir);
        if !released.replace(true) {
            second_go.send(()).unwrap();
            let _ = second_done_rx.recv_timeout(std::time::Duration::from_millis(300));
        }
        done
    })
    .unwrap();
    let after_first = std::fs::read_to_string(entry.join("marker")).unwrap();
    let seen_by_second = second_install.join().unwrap();

    assert_eq!(
        after_first, seen_by_second,
        "the entry one install returned with was replaced by the other"
    );
    std::fs::remove_dir_all(&root).unwrap();
}

/// Pruning takes the key's lock exclusively and only tries it: a key being
/// installed or read is skipped, an entry used since it was listed is kept,
/// and the lock file outlives the entry so everyone locks the same file.
#[test]
fn pruning_skips_a_key_being_installed_or_read_and_keeps_its_lock() {
    let root = std::env::temp_dir().join(format!("content-key-prune-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let entry = entry_with(&root, "key", "old");
    let lock_path = entry.with_extension("lock");

    let installer = std::fs::File::create(&lock_path).unwrap();
    installer.lock().unwrap();
    assert!(
        !prune_entry(&entry, |_| true),
        "a key under install is not pruned"
    );
    drop(installer);

    let reader = read_lock(&entry).unwrap();
    assert!(
        !prune_entry(&entry, |_| true),
        "a key being read is not pruned"
    );
    drop(reader);

    assert!(
        !prune_entry(&entry, |_| false),
        "an entry used since listing is kept"
    );
    assert!(complete(&entry));

    assert!(prune_entry(&entry, |_| true));
    assert!(!entry.exists());
    assert!(lock_path.exists(), "the lock file stays");
    std::fs::remove_dir_all(&root).unwrap();
}

/// No input path exists: the key covers nothing rather than the whole checkout.
#[test]
fn tracked_with_no_present_inputs_is_empty() {
    let root = std::env::temp_dir().join(format!("content-key-empty-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("unrelated.txt"), "x").unwrap();
    assert!(
        Command::new("git")
            .current_dir(&root)
            .args(["init", "-q"])
            .status()
            .unwrap()
            .success()
    );

    assert!(tracked(&root, &["missing"]).unwrap().is_empty());
    std::fs::remove_dir_all(&root).unwrap();
}
