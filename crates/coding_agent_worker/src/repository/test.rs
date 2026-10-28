use super::*;

#[test]
fn transport_does_not_change_repository_identity() {
    let https = Repository::parse("https://github.com/macro-inc/macro.git").unwrap();
    let ssh = Repository::parse("git@github.com:macro-inc/macro.git").unwrap();
    assert_eq!(https.key, ssh.key);
    assert_eq!(https.key, "github.com/macro-inc/macro");
}

#[test]
fn rejects_local_transports_credentials_and_options() {
    for input in [
        "/tmp/repo",
        "file:///tmp/repo",
        "ext::sh -c evil",
        "--upload-pack=evil",
        "https://token@github.com/a/b",
        "https://github.com/a/b?x=y",
        "ssh://root@example.com/a",
    ] {
        assert!(Repository::parse(input).is_err(), "{input}");
    }
}
