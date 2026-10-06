use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use tempfile::TempDir;

const CURRENT_PATH: &str = "/nix/store/00000000000000000000000000000000-current";
const SHARED_PATH: &str = "/nix/store/11111111111111111111111111111111-shared";
const STALE_PATH: &str = "/nix/store/22222222222222222222222222222222-stale";
const BUILD_DERIVATION: &str = "/nix/store/33333333333333333333333333333333-desktop.drv";
const PLANNED_PATH: &str = "/nix/store/44444444444444444444444444444444-planned";

struct CacheFixture {
    temp: TempDir,
    cache_root: PathBuf,
    cache_dir: PathBuf,
}

impl CacheFixture {
    fn new(current_paths: &[&str]) -> Self {
        let temp = tempfile::tempdir().expect("temporary cache fixture");
        let cache_root = temp.path().join("cache");
        let cache_dir = cache_root.join("a".repeat(64));
        fs::create_dir_all(cache_dir.join("nar")).expect("current cache directory");
        fs::create_dir_all(temp.path().join("runner-temp")).expect("runner temporary directory");
        fs::create_dir_all(temp.path().join("bin")).expect("stub commands directory");
        fs::write(
            temp.path().join("runner-temp/desktop-cache-roots"),
            format!("{BUILD_DERIVATION}\n"),
        )
        .expect("build roots");
        fs::write(
            cache_dir.join("nix-cache-info"),
            "StoreDir: /nix/store\nWantMassQuery: 1\nPriority: 40\n",
        )
        .expect("binary cache metadata");

        // Include a duplicate and a derivation: only unique output paths belong
        // on nix copy's stdin, regardless of the closure query's ordering.
        let mut query_paths = current_paths.to_vec();
        query_paths.extend(current_paths.first().copied());
        query_paths.push(BUILD_DERIVATION);
        fs::write(
            temp.path().join("query-outputs"),
            format!("{}\n", query_paths.join("\n")),
        )
        .expect("fake closure query output");
        let expected_paths = current_paths.iter().copied().collect::<BTreeSet<_>>();
        fs::write(
            temp.path().join("expected-copy-input"),
            format!(
                "{}\n",
                expected_paths.into_iter().collect::<Vec<_>>().join("\n")
            ),
        )
        .expect("expected cache export paths");

        let fixture = Self {
            temp,
            cache_root,
            cache_dir,
        };
        fixture.set_planned_outputs(current_paths);
        fixture.write_command(
            "nix-store",
            r#"#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -eq 4 && "$1" == --query && "$2" == --requisites && "$3" == --include-outputs && "$4" == "$STUB_DERIVATION" ]]; then
  printf queried > "$STUB_QUERY_LOG"
  cat "$STUB_QUERY_OUTPUTS"
elif [[ "$#" -eq 3 && "$1" == --query && "$2" == --outputs && "$3" == "$STUB_DERIVATION" ]]; then
  printf queried > "$STUB_PLANNED_LOG"
  cat "$STUB_PLANNED_OUTPUTS"
  [[ ! -f "$STUB_PLANNED_FAILURE" ]]
else
  exit 2
fi
"#,
        );
        fixture.write_command(
            "nix",
            r#"#!/usr/bin/env bash
set -euo pipefail
[[ "$#" -eq 4 && "$1" == copy && "$2" == --stdin && "$3" == --to && "$4" == "$DESKTOP_NIX_CACHE_URL" ]]
[[ -z "$STUB_MISSING_NARINFO" || ! -e "$STUB_MISSING_NARINFO" ]]
cat > "$STUB_COPY_INPUT"
cmp "$STUB_EXPECTED_COPY_INPUT" "$STUB_COPY_INPUT"
printf copied > "$STUB_COPY_LOG"
"#,
        );
        fixture
    }

    fn set_planned_outputs(&self, paths: &[&str]) {
        let contents = if paths.is_empty() {
            String::new()
        } else {
            format!("{}\n", paths.join("\n"))
        };
        fs::write(self.temp.path().join("planned-outputs"), contents)
            .expect("planned derivation outputs");
    }

    fn write_command(&self, name: &str, contents: &str) {
        let path = self.temp.path().join("bin").join(name);
        fs::write(&path, contents).expect("stub command");
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).expect("executable stub");
    }

    fn narinfo_path(&self, store_path: &str) -> PathBuf {
        let name = store_path.rsplit('/').next().expect("store basename");
        let (hash, _) = name.split_once('-').expect("store hash");
        self.cache_dir.join(format!("{hash}.narinfo"))
    }

    fn write_narinfo(&self, store_path: &str, url: Option<&str>) -> PathBuf {
        let path = self.narinfo_path(store_path);
        let url_field = url.map(|url| format!("URL: {url}\n")).unwrap_or_default();
        let contents = format!(
            "StorePath: {store_path}\n{url_field}Compression: zstd\nFileHash: sha256:{}\nFileSize: 1\nNarHash: sha256:{}\nNarSize: 1\nReferences: \n",
            "0".repeat(52),
            "0".repeat(52),
        );
        fs::write(&path, contents).expect("cached narinfo");
        path
    }

    fn write_nar(&self, name: &str) -> PathBuf {
        let path = self.cache_dir.join("nar").join(name);
        fs::write(&path, name).expect("cached NAR");
        path
    }

    fn old_partition(&self) -> PathBuf {
        let path = self.cache_root.join("b".repeat(64));
        fs::create_dir_all(path.join("nar")).expect("old toolchain cache");
        fs::write(path.join("nar/old.nar.zst"), "old toolchain").expect("old cached NAR");
        path
    }

    fn run(&self, missing_narinfo: Option<&Path>) -> Output {
        let fixture_dir = self.temp.path();
        Command::new("bash")
            .args([
                "-c",
                "export PATH=\"$STUB_BIN:$PATH\"\nexec bash \"$STUB_SCRIPT\"",
            ])
            .env("STUB_BIN", fixture_dir.join("bin"))
            .env(
                "STUB_SCRIPT",
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("src/workflows/scripts/save_macos_nix_cache.sh"),
            )
            .env("STUB_DERIVATION", BUILD_DERIVATION)
            .env("STUB_QUERY_OUTPUTS", fixture_dir.join("query-outputs"))
            .env("STUB_QUERY_LOG", fixture_dir.join("query-log"))
            .env("STUB_PLANNED_OUTPUTS", fixture_dir.join("planned-outputs"))
            .env("STUB_PLANNED_LOG", fixture_dir.join("planned-log"))
            .env(
                "STUB_PLANNED_FAILURE",
                fixture_dir.join("planned-query-fails"),
            )
            .env("STUB_COPY_INPUT", fixture_dir.join("copy-input"))
            .env("STUB_COPY_LOG", fixture_dir.join("copy-log"))
            .env(
                "STUB_EXPECTED_COPY_INPUT",
                fixture_dir.join("expected-copy-input"),
            )
            .env(
                "STUB_MISSING_NARINFO",
                missing_narinfo.unwrap_or_else(|| Path::new("")),
            )
            .env("RUNNER_TEMP", fixture_dir.join("runner-temp"))
            .env("GITHUB_STEP_SUMMARY", fixture_dir.join("step-summary"))
            .env("DESKTOP_NIX_CACHE_ROOT", &self.cache_root)
            .env("DESKTOP_NIX_CACHE_DIR", &self.cache_dir)
            .env(
                "DESKTOP_NIX_CACHE_URL",
                format!(
                    "file://{}?compression=zstd&trusted=true&priority=10",
                    self.cache_dir.display()
                ),
            )
            .output()
            .expect("run the actual cache save script")
    }

    fn assert_copy_completed(&self) {
        assert_eq!(
            fs::read(self.temp.path().join("copy-log")).expect("nix copy completed"),
            b"copied"
        );
    }
}

fn assert_success(output: &Output) {
    assert!(
        output.status.success(),
        "cache save failed: {:?}\nstdout: {}\nstderr: {}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
}

fn snapshot(root: &Path) -> BTreeMap<PathBuf, Option<Vec<u8>>> {
    let mut entries = BTreeMap::new();
    for entry in fs::read_dir(root).expect("snapshot cache directory") {
        let path = entry.expect("cache entry").path();
        if path.is_dir() {
            entries.insert(path.clone(), None);
            entries.extend(snapshot(&path));
        } else {
            entries.insert(path.clone(), Some(fs::read(path).expect("cache file")));
        }
    }
    entries
}

#[test]
fn cache_pruning_preserves_current_shared_nars_and_removes_stale_content() {
    let fixture = CacheFixture::new(&[SHARED_PATH, CURRENT_PATH]);
    let current = fixture.write_narinfo(CURRENT_PATH, Some("nar/current.nar.zst"));
    let shared = fixture.write_narinfo(SHARED_PATH, Some("nar/shared.nar.zst"));
    let stale = fixture.write_narinfo(STALE_PATH, Some("nar/shared.nar.zst"));
    let current_nar = fixture.write_nar("current.nar.zst");
    let shared_nar = fixture.write_nar("shared.nar.zst");
    let orphan = fixture.write_nar("orphan.nar.zst");
    let old_partition = fixture.old_partition();
    // Namespace exposes cached directories through a symlink to its volume.
    let mounted_cache = fixture.temp.path().join("mounted-cache");
    fs::rename(&fixture.cache_root, &mounted_cache).expect("mount cache directory");
    symlink(&mounted_cache, &fixture.cache_root).expect("cache volume symlink");

    assert_success(&fixture.run(None));

    fixture.assert_copy_completed();
    for retained in [current, shared, current_nar, shared_nar] {
        assert!(
            retained.exists(),
            "current cache entry removed: {retained:?}"
        );
    }
    for removed in [stale, orphan, old_partition] {
        assert!(!removed.exists(), "stale cache entry retained: {removed:?}");
    }
    assert!(fixture.cache_dir.join("nix-cache-info").exists());
}

#[test]
fn cached_planned_outputs_are_retained_but_only_realized_outputs_are_exported() {
    let fixture = CacheFixture::new(&[CURRENT_PATH]);
    fixture.set_planned_outputs(&[CURRENT_PATH, PLANNED_PATH]);
    fixture.write_narinfo(CURRENT_PATH, Some("nar/current.nar.zst"));
    fixture.write_nar("current.nar.zst");
    let planned = fixture.write_narinfo(PLANNED_PATH, Some("nar/planned.nar.zst"));
    let planned_nar = fixture.write_nar("planned.nar.zst");
    let stale = fixture.write_narinfo(STALE_PATH, Some("nar/stale.nar.zst"));
    let stale_nar = fixture.write_nar("stale.nar.zst");

    assert_success(&fixture.run(None));

    fixture.assert_copy_completed();
    assert!(
        planned.exists(),
        "a needed, unrestored cache entry was pruned"
    );
    assert!(planned_nar.exists(), "a needed, unrestored NAR was pruned");
    assert!(!stale.exists());
    assert!(!stale_nar.exists());
    assert_eq!(
        fs::read_to_string(fixture.temp.path().join("copy-input")).expect("exported paths"),
        format!("{CURRENT_PATH}\n"),
        "nix copy cannot export an unrealized output"
    );
}

#[test]
fn failed_planned_output_queries_leave_the_cache_untouched() {
    for partial_outputs in [false, true] {
        let fixture = CacheFixture::new(&[CURRENT_PATH]);
        fixture.set_planned_outputs(if partial_outputs {
            &[CURRENT_PATH]
        } else {
            &[]
        });
        fs::write(fixture.temp.path().join("planned-query-fails"), "fail")
            .expect("make the planned output query fail");
        fixture.write_narinfo(CURRENT_PATH, Some("nar/current.nar.zst"));
        fixture.write_nar("current.nar.zst");
        fixture.write_narinfo(STALE_PATH, Some("nar/stale.nar.zst"));
        fixture.write_nar("stale.nar.zst");
        fixture.old_partition();
        let before = snapshot(&fixture.cache_root);

        let output = fixture.run(None);

        assert!(
            !output.status.success(),
            "failed query unexpectedly accepted"
        );
        assert!(fixture.temp.path().join("planned-log").exists());
        assert_eq!(snapshot(&fixture.cache_root), before);
        assert!(!fixture.temp.path().join("copy-log").exists());
    }
}

#[test]
fn malformed_retained_nar_urls_abort_without_mutating_the_cache() {
    for url in [
        None,
        Some("../outside.nar.zst"),
        Some("/tmp/outside.nar.zst"),
        Some("nar/../outside.nar.zst"),
        Some("https://example.invalid/outside.nar.zst"),
    ] {
        let fixture = CacheFixture::new(&[SHARED_PATH]);
        fixture.write_narinfo(SHARED_PATH, url);
        // Sort stale metadata before the invalid entry to catch pruning that
        // mutates files while validation is still in progress.
        fixture.write_narinfo(CURRENT_PATH, Some("nar/stale.nar.zst"));
        fixture.write_nar("stale.nar.zst");
        fixture.old_partition();
        let before = snapshot(&fixture.cache_root);

        let output = fixture.run(None);

        assert!(!output.status.success(), "unsafe URL accepted: {url:?}");
        assert_eq!(snapshot(&fixture.cache_root), before, "URL: {url:?}");
        assert!(!fixture.temp.path().join("copy-log").exists());
    }
}

#[test]
fn missing_nar_removes_its_narinfo_before_export_so_copy_can_repair_it() {
    let fixture = CacheFixture::new(&[CURRENT_PATH]);
    let narinfo = fixture.write_narinfo(CURRENT_PATH, Some("nar/missing.nar.zst"));

    assert_success(&fixture.run(Some(&narinfo)));

    fixture.assert_copy_completed();
    assert!(!narinfo.exists(), "incomplete cache entry prevents repair");
}

#[test]
fn missing_build_roots_leave_cache_contents_untouched() {
    let fixture = CacheFixture::new(&[CURRENT_PATH]);
    fixture.write_narinfo(CURRENT_PATH, Some("nar/current.nar.zst"));
    fixture.write_nar("current.nar.zst");
    fixture.old_partition();
    fs::remove_file(fixture.temp.path().join("runner-temp/desktop-cache-roots"))
        .expect("remove roots before running the script");
    let before = snapshot(&fixture.cache_root);

    assert_success(&fixture.run(None));

    assert_eq!(snapshot(&fixture.cache_root), before);
    assert!(!fixture.temp.path().join("query-log").exists());
    assert!(!fixture.temp.path().join("planned-log").exists());
    assert!(!fixture.temp.path().join("copy-log").exists());
}
