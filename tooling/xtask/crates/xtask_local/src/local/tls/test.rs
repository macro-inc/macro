use super::*;

#[test]
fn machine_certificate_verifies_with_existing_ca_and_rejects_other_hosts() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("macro-tls-{unique}"));
    let ca = super::super::proxy::ca_pem();
    let ca_before = std::fs::read(&ca).unwrap();
    let status = Command::new("bash")
        .arg(repo_root().join("infra/local/certs/issue-host.sh"))
        .arg(&dir)
        .arg("coworker-dev")
        .output()
        .unwrap();
    assert!(
        status.status.success(),
        "{}",
        String::from_utf8_lossy(&status.stderr)
    );
    for host in ["coworker-dev", "localhost"] {
        let result = Command::new("openssl")
            .args(["verify", "-CAfile"])
            .arg(&ca)
            .args(["-verify_hostname", host])
            .arg(dir.join("server.pem"))
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{host}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    let wrong = Command::new("openssl")
        .args(["verify", "-CAfile"])
        .arg(&ca)
        .args(["-verify_hostname", "another-machine"])
        .arg(dir.join("server.pem"))
        .output()
        .unwrap();
    assert!(!wrong.status.success());
    assert_eq!(std::fs::read(&ca).unwrap(), ca_before);
    std::fs::remove_dir_all(dir).unwrap();
}
