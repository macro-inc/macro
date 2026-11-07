use super::*;

#[test]
fn accepts_named_branches_and_rejects_revision_expressions() {
    for name in ["main", "develop", "eric/fix-home"] {
        assert_eq!(RepositoryBranch::parse(name.into()).unwrap().as_str(), name);
    }
    for name in [
        "", "@", "-main", "main~1", "a..b", "a//b", "a.lock", ".hidden", "a b", "a@{1}", "a.",
    ] {
        assert!(RepositoryBranch::parse(name.into()).is_err(), "{name}");
    }
}
