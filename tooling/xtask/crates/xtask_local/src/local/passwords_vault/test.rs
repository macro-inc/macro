use super::*;

#[test]
fn reads_one_team_id_per_line_and_skips_blank_lines() {
    let ids =
        team_ids("019a7000-0000-7000-8000-000000000001\n\n019a7000-0000-7000-8000-000000000002\n")
            .unwrap();
    assert_eq!(
        ids,
        vec![
            uuid::Uuid::parse_str("019a7000-0000-7000-8000-000000000001").unwrap(),
            uuid::Uuid::parse_str("019a7000-0000-7000-8000-000000000002").unwrap(),
        ]
    );
    assert!(team_ids("").unwrap().is_empty());
    assert!(team_ids("not-a-team\n").is_err());
}

#[test]
fn provisions_every_team_against_the_loopback_vault_in_one_run() {
    let instance = Instance::derive(Some("passwords-provision"), None).unwrap();
    let teams = [
        uuid::Uuid::parse_str("019a7000-0000-7000-8000-000000000001").unwrap(),
        uuid::Uuid::parse_str("019a7000-0000-7000-8000-000000000002").unwrap(),
    ];
    let args = bootstrap_args(
        &instance,
        Path::new("/fixture/openbao-bootstrap.json"),
        &teams,
    );
    assert!(args[0].ends_with("infra/local/openbao/bootstrap.py"));
    let pairs: Vec<_> = args[1..]
        .chunks(2)
        .map(|pair| (pair[0].as_str(), pair[1].as_str()))
        .collect();
    let address = format!("http://127.0.0.1:{}", instance.port(Port::OpenBao));
    let public_key = instance.artifact_dir().join("passwords-jwt.public.pem");
    assert_eq!(
        pairs,
        vec![
            ("--init-file", "/fixture/openbao-bootstrap.json"),
            ("--address", address.as_str()),
            ("--jwt-public-key", public_key.to_str().unwrap()),
            ("--jwt-issuer", "macro-local-passwords"),
            ("--team-id", "019a7000-0000-7000-8000-000000000001"),
            ("--team-id", "019a7000-0000-7000-8000-000000000002"),
        ]
    );
}

#[test]
fn stages_openbao_config_readable_by_the_container_user_from_a_private_checkout() {
    // A checkout and a previous run under umask 077 leave everything 0600/0700.
    let dir = tempfile::tempdir().unwrap();
    let staged = dir.path().join("openbao");
    std::fs::create_dir(&staged).unwrap();
    std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(staged.join("start.sh"), "stale").unwrap();
    std::fs::set_permissions(
        staged.join("start.sh"),
        std::fs::Permissions::from_mode(0o600),
    )
    .unwrap();

    stage_config(&staged).unwrap();

    let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&staged), 0o755);
    assert_eq!(mode(&staged.join("start.sh")), 0o644);
    assert_eq!(mode(&staged.join("macro-local.hcl")), 0o644);
    assert_eq!(
        std::fs::read(staged.join("start.sh")).unwrap(),
        std::fs::read(repo_root().join("infra/local/openbao/start.sh")).unwrap()
    );
    assert_eq!(
        std::fs::read(staged.join("macro-local.hcl")).unwrap(),
        std::fs::read(repo_root().join("infra/local/openbao/local.hcl")).unwrap()
    );
}

#[test]
#[ignore = "requires Docker and the local OpenBao image"]
fn staged_openbao_files_are_readable_in_a_non_root_container() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("openbao");
    stage_config(&config).unwrap();

    let output = Command::new("docker")
        .args([
            "run",
            "--rm",
            "--pull=never",
            "--network",
            "none",
            "--user",
            "openbao",
            "--entrypoint",
            "/bin/sh",
            "--mount",
        ])
        .arg(format!(
            "type=bind,src={},dst=/openbao/config,readonly",
            config.display()
        ))
        .arg(super::super::inventory::OPENBAO_IMAGE)
        .args([
            "-c",
            "test \"$(id -u)\" -ne 0 && cat /openbao/config/start.sh /openbao/config/macro-local.hcl",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let expected: Vec<u8> = CONFIG_FILES
        .iter()
        .flat_map(|(_, source)| std::fs::read(repo_root().join(source)).unwrap())
        .collect();
    assert_eq!(output.stdout, expected);
}
