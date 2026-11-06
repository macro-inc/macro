use super::*;

/// The whole point of the unified invocation: every service that *can* build
/// together does. A service silently gaining `no_default_features` costs a
/// package-scoped build and, without its own target dir, a full minute of
/// rebuild on the next `run_local`.
#[test]
fn only_services_that_drop_default_features_build_separately() {
    let isolated: Vec<&str> = isolated_services().map(|s| s.cargo_bin).collect();
    assert_eq!(isolated, vec!["search_processing_service"]);
    assert!(unified_services().any(|s| s.cargo_bin == "authentication_service"));
}

#[test]
fn unified_args_pass_local_features_package_qualified() {
    let args = unified_args();
    let features = args
        .iter()
        .position(|a| a == "--features")
        .map(|i| args[i + 1].clone())
        .expect("unified build passes features");
    for feature in features.split(',') {
        assert!(
            feature.contains('/'),
            "{feature} must be package-qualified or it applies to the wrong package"
        );
    }
    assert!(features.contains("authentication_service/no_rate_limit"));
    assert!(features.contains("authentication_service/return_passwordless_code"));
}

#[test]
fn unified_args_build_every_unified_service_bin() {
    let args = unified_args();
    for svc in unified_services() {
        assert!(
            args.windows(2)
                .any(|w| w[0] == "--bin" && w[1] == svc.cargo_bin),
            "{} is missing from the unified build",
            svc.cargo_bin
        );
    }
}

/// Isolation is the load-bearing part: sharing a target dir with the unified
/// build is exactly what invalidates it.
#[test]
fn isolated_args_use_their_own_target_dir() {
    let svc = isolated_services().next().expect("one isolated service");
    let dir = isolated_target_dir(Path::new("/ws"), svc);
    let args = isolated_args(svc, &dir);
    let target_dir = args
        .iter()
        .position(|a| a == "--target-dir")
        .map(|i| args[i + 1].clone())
        .expect("isolated build sets --target-dir");
    assert_eq!(
        target_dir,
        "/ws/target/local-isolated/search_processing_service"
    );
    assert!(args.iter().any(|a| a == "--no-default-features"));
}

#[test]
fn isolated_target_dirs_do_not_collide() {
    let dirs: std::collections::BTreeSet<PathBuf> = isolated_services()
        .map(|svc| isolated_target_dir(Path::new("/ws"), svc))
        .collect();
    assert_eq!(dirs.len(), isolated_services().count());
}

struct PublishDir(PathBuf);

impl PublishDir {
    fn new() -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("macro-publish-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for PublishDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn unchanged_binary_keeps_mtime_for_selective_reload() {
    let dir = PublishDir::new();
    let built = dir.0.join("built");
    let dest = dir.0.join("dest");
    std::fs::write(&built, b"same executable").unwrap();
    std::fs::write(&dest, b"same executable").unwrap();
    let old = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1);
    std::fs::File::options()
        .write(true)
        .open(&dest)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(old))
        .unwrap();
    publish_binary(&built, &dest).unwrap();
    assert_eq!(std::fs::metadata(&dest).unwrap().modified().unwrap(), old);
}

#[test]
#[cfg(unix)]
fn changed_binary_can_replace_a_running_executable() {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use std::process::{Command, Stdio};

    let dir = PublishDir::new();
    let built = dir.0.join("built");
    let dest = dir.0.join("dest");
    std::fs::copy("/bin/sh", &dest).unwrap();
    std::fs::copy(&dest, &built).unwrap();
    std::fs::set_permissions(&built, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::OpenOptions::new()
        .append(true)
        .open(&built)
        .unwrap()
        .write_all(b"changed binary marker")
        .unwrap();
    let mut child = Command::new(&dest)
        .args(["-c", "read -r line"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let result = publish_binary(&built, &dest);
    let still_running = child.try_wait().unwrap().is_none();
    let _ = child.kill();
    child.wait().unwrap();
    result.unwrap();
    assert!(still_running);
    assert_eq!(std::fs::read(&dest).unwrap(), std::fs::read(&built).unwrap());
}
