use super::*;

fn target(arch: &'static str) -> Target {
    match arch {
        "x86_64" => Target {
            triple: "x86_64-unknown-linux-gnu",
            docker_platform: "linux/amd64",
        },
        _ => Target {
            triple: "aarch64-unknown-linux-gnu",
            docker_platform: "linux/arm64",
        },
    }
}

#[test]
fn content_key_is_deterministic() {
    let key = content_key(target("x86_64")).expect("hashes the tracked Dockerfile");
    assert_eq!(key, content_key(target("x86_64")).unwrap());
    assert_eq!(key.len(), 64);
}

/// Volumes and binaries are arch-specific, so an image built for one platform
/// must never satisfy the other's key.
#[test]
fn content_key_is_platform_specific() {
    assert_ne!(
        content_key(target("x86_64")).unwrap(),
        content_key(target("aarch64")).unwrap()
    );
}
