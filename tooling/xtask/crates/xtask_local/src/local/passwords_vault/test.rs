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
            ("--jwt-alg", "ES256"),
            ("--jwt-issuer", "macro-local-passwords"),
            ("--team-id", "019a7000-0000-7000-8000-000000000001"),
            ("--team-id", "019a7000-0000-7000-8000-000000000002"),
        ]
    );
}
