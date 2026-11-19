use super::*;

const HEAD: &str = "1111111111111111111111111111111111111111";
const BASE: &str = "2222222222222222222222222222222222222222";

fn pull(state: &str, head: &str, base_branch: &str) -> Pull {
    Pull {
        number: 7,
        state: state.to_owned(),
        head: Ref {
            name: "topic".to_owned(),
            sha: head.to_owned(),
        },
        base: Ref {
            name: base_branch.to_owned(),
            sha: BASE.to_owned(),
        },
        mergeable: None,
        merge_commit_sha: None,
    }
}

fn commit(parents: &[&str]) -> GitCommit {
    GitCommit {
        tree: Object {
            sha: "3333".to_owned(),
        },
        parents: parents
            .iter()
            .map(|sha| Object {
                sha: (*sha).to_owned(),
            })
            .collect(),
    }
}

#[test]
fn finds_the_open_pull_request_into_the_base_branch() {
    let pulls = vec![
        pull("closed", HEAD, "main"),
        pull("open", HEAD, "another-branch"),
        pull("open", BASE, "main"),
        pull("open", HEAD, "main"),
    ];

    let found = open_pull(pulls, HEAD, "main").expect("the last one matches");

    assert_eq!(found.state, "open");
    assert_eq!(found.base.name, "main");
    assert_eq!(found.head.sha, HEAD);
}

#[test]
fn finds_no_pull_request_for_a_head_that_has_none() {
    assert!(open_pull(vec![pull("closed", HEAD, "main")], HEAD, "main").is_none());
}

#[test]
fn reads_the_base_and_tree_of_a_merge_of_the_head() {
    assert_eq!(
        merge_of(&commit(&[BASE, HEAD]), HEAD),
        Some((BASE.to_owned(), "3333".to_owned()))
    );
}

#[test]
fn refuses_a_merge_commit_built_for_an_older_head() {
    let older = "4444444444444444444444444444444444444444";

    assert_eq!(merge_of(&commit(&[BASE, older]), HEAD), None);
    assert_eq!(merge_of(&commit(&[HEAD, BASE]), HEAD), None);
    assert_eq!(merge_of(&commit(&[HEAD]), HEAD), None);
}

#[test]
fn reads_what_github_answers() {
    let pulls: Vec<Pull> = serde_json::from_str(
        r#"[{"number": 7, "state": "open", "head": {"ref": "topic", "sha": "a"},
             "base": {"ref": "main", "sha": "b"}, "extra": 1}]"#,
    )
    .expect("a pull request as the commit's list gives it");
    assert_eq!(pulls[0].mergeable, None);

    let pull: Pull = serde_json::from_str(
        r#"{"number": 7, "state": "open", "head": {"ref": "topic", "sha": "a"},
            "base": {"ref": "main", "sha": "b"}, "mergeable": true, "merge_commit_sha": "c"}"#,
    )
    .expect("a pull request as its own endpoint gives it");
    assert_eq!(pull.mergeable, Some(true));
    assert_eq!(pull.merge_commit_sha.as_deref(), Some("c"));

    let commit: GitCommit =
        serde_json::from_str(r#"{"tree": {"sha": "t"}, "parents": [{"sha": "b"}, {"sha": "a"}]}"#)
            .expect("a git commit");
    assert_eq!(
        merge_of(&commit, "a"),
        Some(("b".to_owned(), "t".to_owned()))
    );
}
