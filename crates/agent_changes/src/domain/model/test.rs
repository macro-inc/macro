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
        ChangesetSource::GithubPullRequest.to_string(),
        "github_pull_request"
    );
    assert_eq!(
        "github_pull_request".parse::<ChangesetSource>().unwrap(),
        ChangesetSource::GithubPullRequest
    );
    assert_eq!(AttemptOutcome::NotReady.to_string(), "not_ready");
    assert_eq!(FileSide::Base.to_string(), "base");
    assert_eq!("head".parse::<FileSide>().unwrap(), FileSide::Head);
}

#[test]
fn changeset_file_paths_reject_traversal_and_empty_segments() {
    assert_eq!(changeset_file_path("src/lib.rs"), Some("src/lib.rs"));
    assert_eq!(changeset_file_path(".gitignore"), Some(".gitignore"));
    for path in [
        "",
        "/src/lib.rs",
        "src//lib.rs",
        "src/./lib.rs",
        "src/../secret.rs",
        "src/\0lib.rs",
    ] {
        assert_eq!(changeset_file_path(path), None, "{path:?}");
    }
}

#[test]
fn a_changeset_includes_rename_sources() {
    let changeset = Changeset {
        id: ChangesetId::new(),
        session: AgentSessionId::TEST_A,
        source: ChangesetSource::GithubPullRequest,
        range: ChangesetRange::default(),
        files: vec![ChangedFile {
            path: "b.rs".to_owned(),
            previous_path: Some("a.rs".to_owned()),
            kind: FileChangeKind::Renamed,
            additions: 0,
            deletions: 0,
            binary: false,
            patch_omitted: false,
        }],
        additions: 0,
        deletions: 0,
        patch_bytes: 0,
        truncated: false,
        captured_at: chrono::Utc::now(),
    };
    assert!(changeset.contains_path("a.rs"));
    assert!(changeset.contains_path("b.rs"));
    assert!(!changeset.contains_path("c.rs"));
    assert_eq!(changeset.rev_for(FileSide::Head), None);
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
