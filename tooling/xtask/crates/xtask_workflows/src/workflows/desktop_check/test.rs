use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::*;

/// Each package's name, from every `Cargo.toml` under `dir`, with its directory
/// relative to `root`.
fn package_dirs(root: &Path, dir: &Path, found: &mut HashMap<String, PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("read directory") {
        let path = entry.expect("directory entry").path();
        let name = path.file_name().and_then(|name| name.to_str());
        if path.is_dir() && !matches!(name, Some("target" | "node_modules" | ".git")) {
            package_dirs(root, &path, found);
            continue;
        }
        if name != Some("Cargo.toml") {
            continue;
        }

        let manifest: toml::Value =
            toml::from_str(&std::fs::read_to_string(&path).expect("read manifest"))
                .expect("parse manifest");
        if let Some(package) = manifest
            .get("package")
            .and_then(|package| package.get("name"))
            .and_then(toml::Value::as_str)
        {
            let package_dir = path.parent().expect("manifest directory");
            found.insert(
                package.to_string(),
                package_dir
                    .strip_prefix(root)
                    .expect("under root")
                    .to_path_buf(),
            );
        }
    }
}

/// A local crate the desktop app builds but the filter misses could break the
/// desktop build on a pull request that never runs this check.
#[test]
fn paths_cover_every_local_crate_the_desktop_app_builds() {
    let root = xtask_paths::repo_root();
    let lockfile: toml::Value = toml::from_str(
        &std::fs::read_to_string(root.join("apps/web/tauri/Cargo.lock")).expect("read lockfile"),
    )
    .expect("parse lockfile");
    let mut dirs = HashMap::new();
    package_dirs(&root, &root.join("crates"), &mut dirs);
    package_dirs(&root, &root.join("apps/web/tauri"), &mut dirs);

    let local = lockfile["package"]
        .as_array()
        .expect("packages")
        .iter()
        .filter(|package| package.get("source").is_none())
        .map(|package| package["name"].as_str().expect("package name"));

    for name in local {
        let dir = dirs
            .get(name)
            .unwrap_or_else(|| panic!("no Cargo.toml names local package {name}"));
        let covered = PATHS.iter().any(|glob| {
            glob.as_str()
                .strip_suffix("/**")
                .is_some_and(|prefix| dir.starts_with(prefix))
        });
        assert!(covered, "PATHS has no glob for {name} ({})", dir.display());
    }
}
