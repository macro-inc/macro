use super::*;

#[test]
fn repository_slugs_parse_every_provider_spelling() {
    for text in [
        "https://github.com/macro-inc/macro",
        "https://github.com/macro-inc/macro.git",
        "http://github.com/macro-inc/macro/",
        "github.com/macro-inc/macro",
        "git@github.com:macro-inc/macro.git",
        "macro-inc/macro",
    ] {
        let slug = RepositorySlug::parse(text).unwrap_or_else(|| panic!("{text} should parse"));
        assert_eq!(slug.owner, "macro-inc", "{text}");
        assert_eq!(slug.name, "macro", "{text}");
        assert_eq!(slug.https_url(), "https://github.com/macro-inc/macro");
    }
}

#[test]
fn repository_slugs_reject_anything_that_is_not_owner_and_name() {
    for text in [
        "",
        "macro",
        "https://github.com/macro-inc",
        "https://github.com/macro-inc/macro/pull/1",
        "https://gitlab.com/macro-inc/macro",
        "owner/na me",
    ] {
        assert!(
            RepositorySlug::parse(text).is_none(),
            "{text:?} should not parse"
        );
    }
}

#[test]
fn enums_round_trip_through_their_wire_strings() {
    assert_eq!(FileChangeKind::Renamed.to_string(), "renamed");
    assert_eq!(
        "renamed".parse::<FileChangeKind>().unwrap(),
        FileChangeKind::Renamed
    );
    assert_eq!(
        ChangesetSource::CursorGithubCompare.to_string(),
        "cursor_github_compare"
    );
    assert_eq!(
        "macrod_git".parse::<ChangesetSource>().unwrap(),
        ChangesetSource::MacrodGit
    );
    assert_eq!(AttemptOutcome::NotReady.to_string(), "not_ready");
}
