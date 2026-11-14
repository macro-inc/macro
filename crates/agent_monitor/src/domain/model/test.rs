use super::{PrRef, RepoName};

#[test]
fn a_repository_name_is_compared_without_regard_to_case() {
    let typed = RepoName::parse("Example-Org/Widgets").expect("a repo");
    assert_eq!(
        typed,
        RepoName::parse("example-org/widgets").expect("a repo")
    );
    assert_eq!(typed.owner(), "example-org");
    assert_eq!(typed.name(), "widgets");
    assert_eq!(RepoName::parse("example-org"), None);
    assert_eq!(RepoName::parse("example org/widgets"), None);

    // The same pull request through differently cased URLs is one row.
    let upper = PrRef::last_in("https://github.com/Example-Org/Widgets/pull/42").expect("a PR");
    let lower = PrRef::last_in("https://github.com/example-org/widgets/pull/42").expect("a PR");
    assert_eq!(upper.id(), lower.id());
}
