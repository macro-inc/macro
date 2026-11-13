use super::*;

#[test]
fn accepts_every_remote_form_of_the_macro_repository() {
    for url in [
        "https://github.com/macro-inc/macro",
        "https://github.com/macro-inc/macro.git",
        "https://github.com/macro-inc/macro/",
        "https://GitHub.com/Macro-Inc/Macro.git",
        "http://github.com/macro-inc/macro",
        concat!("https://user:token", "@", "github.com/macro-inc/macro.git"),
        concat!("git", "@", "github.com:macro-inc/macro.git"),
        concat!("git", "@", "github.com:macro-inc/macro"),
        concat!("ssh://git", "@", "github.com/macro-inc/macro.git"),
        concat!("ssh://git", "@", "github.com:22/macro-inc/macro"),
    ] {
        assert_eq!(
            RepositoryScope::of(Some(url)),
            RepositoryScope::Allowed("github.com/macro-inc/macro".to_owned()),
            "{url}"
        );
    }
}

#[test]
fn refuses_other_repositories_and_lookalikes() {
    for url in [
        "https://github.com/someone-else/other",
        "https://github.com/macro-inc/macro-connect",
        "https://github.com/macro-inc/macro/tree/main",
        "https://gitlab.com/macro-inc/macro",
        "https://github.com.evil.example/macro-inc/macro",
        concat!("git", "@", "github.com:someone/macro-inc-macro.git"),
        "/home/test/scratch/repos/macro",
        "file:///home/test/macro",
        "not a url",
    ] {
        assert_eq!(
            RepositoryScope::of(Some(url)),
            RepositoryScope::Other,
            "{url}"
        );
    }
}

#[test]
fn an_event_without_a_repository_is_missing() {
    assert_eq!(RepositoryScope::of(None), RepositoryScope::Missing);
}
