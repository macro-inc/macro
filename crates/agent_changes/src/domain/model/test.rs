use super::*;

#[test]
fn captured_branch_requires_the_same_repository() {
    let branch = CapturedBranch {
        repository_url: "https://github.com/macro-inc/macro".to_owned(),
        branch: "cursor/work".to_owned(),
    };
    assert_eq!(
        branch.for_repository("https://github.com/MACRO-INC/macro.git"),
        Some("cursor/work")
    );
    for repository in [
        "https://github.com/macro-inc/replaced",
        "https://gitlab.com/macro-inc/macro",
        "https://user@github.com/macro-inc/macro",
        "",
    ] {
        assert_eq!(branch.for_repository(repository), None);
    }
}

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
        ChangesetSource::GithubPullRequest.to_string(),
        "github_pull_request"
    );
    assert_eq!(
        "github_pull_request".parse::<ChangesetSource>().unwrap(),
        ChangesetSource::GithubPullRequest
    );
    assert_eq!(AttemptOutcome::NotReady.to_string(), "not_ready");
}

#[test]
fn pull_request_urls_accept_github_pr_links_only() {
    for suffix in [
        "",
        "/",
        "/files",
        "/commits",
        "/checks",
        "#discussion_r1",
        "?diff=split",
    ] {
        let pr = PullRequestRef::parse(&format!("https://github.com/owner/repo/pull/123{suffix}"))
            .unwrap();
        assert_eq!(pr.repository.to_string(), "owner/repo");
        assert_eq!(pr.number.get(), 123);
    }
    for url in [
        "https://github.com/owner/repo/tree/work",
        "https://github.com/owner/repo/pull/0",
        "https://github.com/owner/repo/pull/-1",
        "https://github.com/owner/repo/pull/1/anything",
        "https://github.com/owner/repo/pull/1//anything",
        "https://github.com.evil.example/owner/repo/pull/1",
        "https://evil.example/owner/repo/pull/1",
        "https://user:secret@github.com/owner/repo/pull/1",
        "http://github.com/owner/repo/pull/1",
        "https://github.com/owner/repo/pull/nope",
    ] {
        assert!(PullRequestRef::parse(url).is_none(), "accepted {url}");
    }
}
