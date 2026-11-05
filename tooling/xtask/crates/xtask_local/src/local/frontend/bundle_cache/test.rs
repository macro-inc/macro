use super::*;

/// A throwaway repository with one tracked frontend file, one gitignored wasm
/// package and one ignored `node_modules` file.
fn repo(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("bundle-cache-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("apps/web/src/wasm")).unwrap();
    std::fs::create_dir_all(dir.join("apps/web/node_modules/dep")).unwrap();
    std::fs::write(dir.join("apps/web/.gitignore"), "wasm/\nnode_modules/\ndist/\n").unwrap();
    std::fs::write(dir.join("apps/web/src/app.ts"), "export const a = 1;\n").unwrap();
    std::fs::write(dir.join("apps/web/src/wasm/engine_bg.wasm"), "v1").unwrap();
    std::fs::write(dir.join("apps/web/node_modules/dep/index.js"), "1").unwrap();
    for args in [
        &["init", "-q"][..],
        &["add", "-A"],
        &["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"],
    ] {
        assert!(Command::new("git").current_dir(&dir).args(args).status().unwrap().success());
    }
    dir
}

fn build() -> Command {
    let mut cmd = Command::new("bun");
    cmd.args(["run", "build"]).env("VITE_LOCAL_ONLY", "true");
    cmd
}

/// Every kind of input a stale bundle could hide behind changes the key: a
/// modified tracked file, a new untracked file, a rebuilt wasm package, and
/// the build's env. The real index is left as it was.
#[test]
fn key_follows_sources_wasm_and_env_on_disk() {
    let dir = repo("inputs");
    let base = key(&dir, &build()).unwrap();
    assert_eq!(base, key(&dir, &build()).unwrap(), "same inputs, same key");

    std::fs::write(dir.join("apps/web/node_modules/dep/index.js"), "2").unwrap();
    std::fs::create_dir_all(dir.join("apps/web/dist")).unwrap();
    std::fs::write(dir.join("apps/web/dist/index.html"), "<html>").unwrap();
    assert_eq!(base, key(&dir, &build()).unwrap(), "node_modules and dist are not inputs");

    std::fs::write(dir.join("apps/web/src/app.ts"), "export const a = 2;\n").unwrap();
    let edited = key(&dir, &build()).unwrap();
    assert_ne!(base, edited, "an uncommitted edit");

    std::fs::write(dir.join("apps/web/src/new.ts"), "export const b = 1;\n").unwrap();
    let added = key(&dir, &build()).unwrap();
    assert_ne!(edited, added, "an untracked file");

    std::fs::write(dir.join("apps/web/src/wasm/engine_bg.wasm"), "v2").unwrap();
    let rebuilt = key(&dir, &build()).unwrap();
    assert_ne!(added, rebuilt, "a rebuilt wasm package");

    let mut other_env = build();
    other_env.env("VITE_ENABLE_SOMETHING", "true");
    assert_ne!(rebuilt, key(&dir, &other_env).unwrap(), "a VITE_ variable");

    let status = Command::new("git").current_dir(&dir).args(["status", "--porcelain"]).output().unwrap();
    assert_eq!(
        String::from_utf8_lossy(&status.stdout),
        " M apps/web/src/app.ts\n?? apps/web/src/new.ts\n",
        "the checkout's own index is untouched"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
