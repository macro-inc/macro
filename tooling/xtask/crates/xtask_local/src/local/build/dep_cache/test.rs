use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use super::*;
use crate::local::test_support::TempDir;

const REG: &str = "0123456789abcdef";
const REG_BUILD: &str = "fedcba9876543210";
const WS: &str = "00000000000000aa";

fn write(path: &Path, body: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, body).unwrap();
}

/// A target/debug with one registry unit (serde-json, plus a build script for
/// openssl-sys) and one workspace unit (contacts).
fn fake_target(root: &Path) -> PathBuf {
    let t = root.join("target/debug");
    write(
        &t.join(format!(".fingerprint/serde-json-{REG}/lib-serde_json")),
        "fp",
    );
    write(&t.join(format!("deps/libserde_json-{REG}.rlib")), "rlib");
    write(&t.join(format!("deps/libserde_json-{REG}.rmeta")), "rmeta");
    write(&t.join(format!("deps/serde_json-{REG}.d")), "d");
    write(
        &t.join(format!(".fingerprint/openssl-sys-{REG_BUILD}/run")),
        "fp",
    );
    write(
        &t.join(format!("build/openssl-sys-{REG_BUILD}/out/lib/libssl.a")),
        "a",
    );
    write(
        &t.join(format!("build/openssl-sys-{REG_BUILD}/output")),
        "out",
    );
    write(
        &t.join(format!(".fingerprint/contacts-{WS}/lib-contacts")),
        "fp",
    );
    write(&t.join(format!("deps/libcontacts-{WS}.rlib")), "rlib");
    write(&t.join("contacts_service"), "bin");
    t
}

fn workspace() -> HashSet<String> {
    ["contacts".to_owned()].into_iter().collect()
}

fn key() -> Key {
    Key {
        lockfile: b"lock v1".to_vec(),
        cargo_config: Vec::new(),
        rustc_version: "rustc 1.93.0".to_owned(),
        build_args: vec!["--bin".to_owned(), "contacts_service".to_owned()],
        env: vec![("CARGO_INCREMENTAL".to_owned(), "1".to_owned())],
    }
}

#[test]
fn selects_only_registry_units() {
    let tmp = TempDir::new("select");
    let t = fake_target(tmp.path());
    let paths: Vec<String> = registry_unit_paths(&t, &workspace())
        .unwrap()
        .iter()
        .map(|p| p.display().to_string())
        .collect();
    assert_eq!(
        paths,
        vec![
            format!(".fingerprint/openssl-sys-{REG_BUILD}"),
            format!(".fingerprint/serde-json-{REG}"),
            format!("build/openssl-sys-{REG_BUILD}"),
            format!("deps/libserde_json-{REG}.rlib"),
            format!("deps/libserde_json-{REG}.rmeta"),
            format!("deps/serde_json-{REG}.d"),
        ]
    );
}

#[test]
fn unit_names_parse() {
    assert_eq!(
        split_unit_dir(&format!("openssl-sys-{REG}")),
        Some(("openssl-sys", REG))
    );
    assert_eq!(split_unit_dir("openssl-sys"), None);
    assert_eq!(deps_file_hash(&format!("libring-{REG}.so")), Some(REG));
    assert_eq!(deps_file_hash(&format!("ring-{REG}.d")), Some(REG));
    assert_eq!(deps_file_hash("contacts_service"), None);
}

#[test]
fn every_key_input_changes_the_digest() {
    let base = key().digest();
    let mut k = key();
    k.lockfile = b"lock v2".to_vec();
    assert_ne!(k.digest(), base, "Cargo.lock");
    let mut k = key();
    k.rustc_version = "rustc 1.94.0".to_owned();
    assert_ne!(k.digest(), base, "toolchain");
    let mut k = key();
    k.env = vec![("CARGO_INCREMENTAL".to_owned(), "0".to_owned())];
    assert_ne!(k.digest(), base, "flags");
    let mut k = key();
    k.build_args.push("--features".to_owned());
    assert_ne!(k.digest(), base, "build args");
    let mut k = key();
    k.cargo_config = b"[build]".to_vec();
    assert_ne!(k.digest(), base, "cargo config");
    assert_eq!(key().digest(), base, "stable");
}

#[test]
fn key_env_keeps_only_build_relevant_vars() {
    let vars = [
        ("PATH", "/bin"),
        ("CARGO_PROFILE_DEV_DEBUG", "0"),
        ("RUSTFLAGS", "-C link-arg=-fuse-ld=mold"),
        ("CFLAGS_x86_64_unknown_linux_gnu", "-I/x"),
        ("HOME", "/home/u"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()));
    let names: Vec<String> = key_env(vars).into_iter().map(|(k, _)| k).collect();
    assert_eq!(
        names,
        [
            "CARGO_PROFILE_DEV_DEBUG",
            "CFLAGS_x86_64_unknown_linux_gnu",
            "RUSTFLAGS"
        ]
    );
}

#[test]
fn save_keeps_mtimes_and_seed_sets_one_current_time() {
    let tmp = TempDir::new("roundtrip");
    let t = fake_target(&tmp.path().join("a"));
    let old = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    fs::File::options()
        .write(true)
        .open(t.join(format!("deps/libserde_json-{REG}.rlib")))
        .unwrap()
        .set_modified(old)
        .unwrap();

    let entry = tmp.path().join("cache").join(key().digest());
    save(&entry, &t, &workspace()).unwrap();
    assert!(is_complete(&entry));

    let cached = entry.join(format!("deps/libserde_json-{REG}.rlib"));
    assert_eq!(fs::metadata(&cached).unwrap().modified().unwrap(), old);

    let fresh = tmp.path().join("b/target/debug");
    assert!(!is_seeded(&fresh, &entry));
    let before = SystemTime::now();
    seed(&entry, &fresh).unwrap();
    mark_seeded(&fresh, &entry).unwrap();
    assert!(is_seeded(&fresh, &entry));

    // Cargo rebuilds a unit whose dependency is newer, so seeded files must not
    // look older than what the target already built: all get one current time.
    let rlib = fresh.join(format!("deps/libserde_json-{REG}.rlib"));
    assert_eq!(fs::read_to_string(&rlib).unwrap(), "rlib");
    let seeded = fs::metadata(&rlib).unwrap().modified().unwrap();
    assert!(seeded >= before);
    let script = fresh.join(format!("build/openssl-sys-{REG_BUILD}/output"));
    assert_eq!(fs::metadata(&script).unwrap().modified().unwrap(), seeded);
    assert!(
        fresh
            .join(format!("build/openssl-sys-{REG_BUILD}/out/lib/libssl.a"))
            .is_file()
    );
    assert!(!fresh.join(format!("deps/libcontacts-{WS}.rlib")).exists());
    assert!(!fresh.join(format!(".fingerprint/contacts-{WS}")).exists());
    assert!(!fresh.join("contacts_service").exists());
}

/// A build in a seeded target rewrites its files; the cache must not change.
#[test]
fn seeded_files_are_independent_of_the_cache() {
    let tmp = TempDir::new("independent");
    let t = fake_target(&tmp.path().join("a"));
    let entry = tmp.path().join("cache").join(key().digest());
    save(&entry, &t, &workspace()).unwrap();
    let cached = entry.join(format!("deps/libserde_json-{REG}.rlib"));
    let before = fs::metadata(&cached).unwrap();

    let fresh = tmp.path().join("b/target/debug");
    seed(&entry, &fresh).unwrap();
    let seeded = fresh.join(format!("deps/libserde_json-{REG}.rlib"));
    assert_ne!(fs::metadata(&seeded).unwrap().ino(), before.ino());
    fs::write(&seeded, "rebuilt in place").unwrap();

    let after = fs::metadata(&cached).unwrap();
    assert_eq!(fs::read_to_string(&cached).unwrap(), "rlib");
    assert_eq!(after.ino(), before.ino());
    assert_eq!(after.modified().unwrap(), before.modified().unwrap());
    // And the source worktree is untouched by the save.
    assert_eq!(
        fs::read_to_string(t.join(format!("deps/libserde_json-{REG}.rlib"))).unwrap(),
        "rlib"
    );
}

#[test]
fn a_second_save_of_the_same_key_keeps_the_first() {
    let tmp = TempDir::new("race");
    let t = fake_target(&tmp.path().join("a"));
    let entry = tmp.path().join("cache").join(key().digest());
    save(&entry, &t, &workspace()).unwrap();
    save(&entry, &t, &workspace()).unwrap();
    let leftovers: Vec<_> = fs::read_dir(tmp.path().join("cache"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name())
        .collect();
    assert_eq!(leftovers.len(), 1);
}

#[test]
fn seed_refuses_an_unfinished_entry() {
    let tmp = TempDir::new("unfinished");
    let entry = tmp.path().join("cache/abc");
    write(&entry.join("deps/x"), "x");
    assert!(seed(&entry, &tmp.path().join("t")).is_err());
}

#[test]
fn evict_keeps_the_most_recently_used() {
    let tmp = TempDir::new("evict");
    let root = tmp.path().join("cache");
    for (i, name) in ["old", "mid", "new"].iter().enumerate() {
        let marker = root.join(name).join(COMPLETE_MARKER);
        write(&marker, "1");
        fs::File::options()
            .write(true)
            .open(&marker)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_000 + i as u64))
            .unwrap();
    }
    evict(&root, 2).unwrap();
    assert!(!root.join("old").exists());
    assert!(root.join("mid").exists());
    assert!(root.join("new").exists());
}

/// Build scripts leave read-only files (aws-lc-sys does); saving and seeding
/// must still copy them with their mtimes.
#[test]
fn read_only_outputs_are_copied() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = TempDir::new("readonly");
    let t = fake_target(&tmp.path().join("a"));
    let lib = t.join(format!("build/openssl-sys-{REG_BUILD}/out/lib/libssl.a"));
    fs::set_permissions(&lib, fs::Permissions::from_mode(0o444)).unwrap();
    let entry = tmp.path().join("cache").join(key().digest());
    save(&entry, &t, &workspace()).unwrap();
    let fresh = tmp.path().join("b/target/debug");
    seed(&entry, &fresh).unwrap();
    let cached = entry.join(format!("build/openssl-sys-{REG_BUILD}/out/lib/libssl.a"));
    assert_eq!(
        fs::metadata(&cached).unwrap().modified().unwrap(),
        fs::metadata(&lib).unwrap().modified().unwrap()
    );
    let seeded = fresh.join(format!("build/openssl-sys-{REG_BUILD}/out/lib/libssl.a"));
    assert_eq!(fs::read_to_string(&seeded).unwrap(), "a");
    // Let TempDir's drop remove the copies.
    for p in [
        &lib,
        &seeded,
        &entry.join(format!("build/openssl-sys-{REG_BUILD}/out/lib/libssl.a")),
    ] {
        fs::set_permissions(p, fs::Permissions::from_mode(0o644)).unwrap();
    }
}

/// A target that already built any of the entry's units (a developer's own
/// builds) gets nothing: seeded crates next to ones built here fail with E0460.
#[test]
fn a_target_with_any_of_the_units_is_not_seeded() {
    let tmp = TempDir::new("overlap");
    let t = fake_target(&tmp.path().join("a"));
    let entry = tmp.path().join("cache").join(key().digest());
    save(&entry, &t, &workspace()).unwrap();

    let other = tmp.path().join("b/target/debug");
    let own = other.join(format!("deps/libserde_json-{REG}.rlib"));
    write(&own, "built here");
    write(
        &other.join(format!(".fingerprint/serde-json-{REG}/lib-serde_json")),
        "own fingerprint",
    );
    assert_eq!(seed(&entry, &other).unwrap(), Seeded::Overlap(1));

    assert_eq!(fs::read_to_string(&own).unwrap(), "built here");
    assert!(
        !other
            .join(format!("build/openssl-sys-{REG_BUILD}"))
            .exists()
    );
    assert!(
        !other
            .join(format!("deps/libserde_json-{REG}.rmeta"))
            .exists()
    );
}

#[test]
fn an_empty_target_gets_every_unit() {
    let tmp = TempDir::new("whole");
    let t = fake_target(&tmp.path().join("a"));
    let entry = tmp.path().join("cache").join(key().digest());
    save(&entry, &t, &workspace()).unwrap();
    // The rlib, rmeta and .d; the build script's two files; two fingerprints.
    assert_eq!(
        seed(&entry, &tmp.path().join("b/target/debug")).unwrap(),
        Seeded::Copied(7)
    );
}
