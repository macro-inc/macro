use super::*;
use std::process::Command;

use crate::local::instance::Instance;

#[test]
fn isolated_ssh_ignores_apple_usekeychain() {
    let config = std::env::temp_dir().join(format!(
        "sdk-webhook-usekeychain-{}-{}.conf",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    std::fs::write(&config, "Host *\n  UseKeychain yes\n").expect("write UseKeychain config");

    let rejected = Command::new("ssh")
        .args(["-F"])
        .arg(&config)
        .args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=1", "-p", "1"])
        .arg("sdk-webhook@127.0.0.1")
        .output()
        .expect("spawn ssh");
    let rejected_err = String::from_utf8_lossy(&rejected.stderr);
    let _ = std::fs::remove_file(&config);

    assert!(
        rejected_err.to_ascii_lowercase().contains("usekeychain"),
        "expected Nix/OpenSSH to reject UseKeychain: {rejected_err}"
    );

    let flags = ssh_client_flags(std::path::Path::new("/tmp/missing-relay-key"), 1, 1);
    assert!(
        flags.windows(2).any(|pair| pair == ["-F", "/dev/null"]),
        "relay ssh must ignore ~/.ssh/config, flags={flags:?}"
    );
    assert!(
        flags.windows(2).any(|pair| pair == ["-o", "BatchMode=yes"]),
        "relay ssh must not prompt, flags={flags:?}"
    );
    assert!(
        flags
            .windows(2)
            .any(|pair| pair == ["-o", "IdentitiesOnly=yes"]),
        "relay ssh must use only the generated key, flags={flags:?}"
    );
}

#[test]
fn start_surfaces_ssh_stderr() {
    let instance = Instance::derive(
        Some(&format!("sdk-wh-{}", std::process::id())),
        Some(31_000),
    )
    .unwrap();
    let err = start(&instance).unwrap_err().to_string();
    let _ = std::fs::remove_dir_all(instance.artifact_dir());
    assert!(
        err.contains("Connection refused") || err.to_ascii_lowercase().contains("ssh:"),
        "expected the real ssh error, got {err}"
    );
}

struct TunnelTest {
    instance: Instance,
    children: Vec<Child>,
}

impl TunnelTest {
    fn new(name: &str) -> Self {
        let instance = Instance::derive(
            Some(&format!("sdk-wh-{name}-{}", std::process::id())),
            Some(31_000),
        )
        .unwrap();
        std::fs::create_dir_all(key_dir(&instance)).unwrap();
        Self {
            instance,
            children: Vec::new(),
        }
    }

    fn command(&self, script: &str) -> Command {
        let mut command = Command::new("sh");
        command
            .args(["-c", script, "test-ssh"])
            .arg(key_dir(&self.instance));
        command
    }
}

impl Drop for TunnelTest {
    fn drop(&mut self) {
        for child in &mut self.children {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = std::fs::remove_dir_all(self.instance.artifact_dir());
    }
}

#[test]
fn start_retries_port_conflicts_and_relay_startup_errors() {
    for error in [
        "Error: remote port forwarding failed for listen port 8787",
        "ssh: connect to host 127.0.0.1 port 31023: Connection refused",
        "kex_exchange_identification: read: Connection reset by peer",
    ] {
        let mut test = TunnelTest::new("retry");
        let mut command = test.command(
            r#"
            if [ ! -f "$1/attempted" ]; then
                touch "$1/attempted"
                echo "$2" >&2
                exit 255
            fi
            exec sleep 60
            "#,
        );
        command.arg(error);
        let child = start_tunnel(&test.instance, &mut command).unwrap();
        test.children.push(child);
        assert_eq!(
            std::fs::read_to_string(pid_path(&test.instance)).unwrap(),
            test.children[0].id().to_string()
        );
        assert!(test.children[0].try_wait().unwrap().is_none());
    }
}

#[test]
fn start_preserves_permanent_forwarding_errors_after_bounded_retries() {
    let test = TunnelTest::new("busy");
    let mut command = test
        .command("echo 'Error: remote port forwarding failed for listen port 8787' >&2; exit 255");
    let error = start_tunnel(&test.instance, &mut command).unwrap_err();
    assert!(error.to_string().contains("listen port 8787"));
    assert!(!pid_path(&test.instance).exists());
}

#[test]
fn start_does_not_retry_authentication_errors() {
    let test = TunnelTest::new("auth");
    let mut command = test.command(
        r#"echo attempt >> "$1/attempts"; echo 'Permission denied (publickey).' >&2; exit 255"#,
    );
    let error = start_tunnel(&test.instance, &mut command).unwrap_err();
    assert!(error.to_string().contains("Permission denied (publickey)"));
    assert_eq!(
        std::fs::read_to_string(key_dir(&test.instance).join("attempts")).unwrap(),
        "attempt\n"
    );
    assert!(!pid_path(&test.instance).exists());
}

#[test]
fn concurrent_starts_leave_only_the_recorded_tunnel_running() {
    let mut test = TunnelTest::new("concurrent");
    let barrier = std::sync::Barrier::new(2);
    let children = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let mut command = test.command("exec sleep 60");
                let instance = &test.instance;
                let barrier = &barrier;
                scope.spawn(move || {
                    barrier.wait();
                    start_tunnel(instance, &mut command)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap().unwrap())
            .collect()
    });
    test.children = children;
    let pid = std::fs::read_to_string(pid_path(&test.instance)).unwrap();
    for child in &mut test.children {
        assert_eq!(
            child.try_wait().unwrap().is_none(),
            child.id().to_string() == pid,
            "only the last start should still own a running tunnel"
        );
    }
}
