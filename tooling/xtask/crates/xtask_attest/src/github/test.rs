use super::*;

const HEAD: &str = "1111111111111111111111111111111111111111";
const BASE: &str = "2222222222222222222222222222222222222222";
const TREE: &str = "3333333333333333333333333333333333333333";

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
        parents: parents
            .iter()
            .map(|sha| Object {
                sha: (*sha).to_owned(),
            })
            .collect(),
    }
}

fn status(description: Option<&str>) -> Status {
    Status {
        context: "attested/web-app/cycles".to_owned(),
        state: "success".to_owned(),
        description: description.map(str::to_owned),
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
fn takes_only_a_merge_commit_built_for_this_head() {
    let older = "4444444444444444444444444444444444444444";

    assert!(merges(&commit(&[BASE, HEAD]), HEAD));
    assert!(!merges(&commit(&[BASE, older]), HEAD));
    assert!(!merges(&commit(&[HEAD, BASE]), HEAD));
    assert!(!merges(&commit(&[HEAD]), HEAD));
}

#[test]
fn reads_what_a_status_vouches_for() {
    let stated = status(Some(&format!("fp=0123456789abcdef tree={TREE}")));
    let with_note = status(Some(&format!(
        "fp=0123456789abcdef tree={TREE} failed on a runner"
    )));
    let expected = Claim {
        fingerprint: "0123456789abcdef".to_owned(),
        tree: TREE.to_owned(),
    };

    assert_eq!(stated.claim(), Some(expected));
    assert_eq!(
        with_note.claim().map(|claim| claim.tree),
        Some(TREE.to_owned())
    );
}

#[test]
fn a_status_someone_wrote_by_hand_vouches_for_nothing() {
    let odd = [
        "looks good to me".to_owned(),
        "fp=0123456789abcdef".to_owned(),
        "fp=0123456789abcdef tree=3333".to_owned(),
        format!("fp=0123456789ABCDEF tree={TREE}"),
        format!("fp=0123456789abcdef tree={TREE}3"),
        format!("fp=0123456789abcdef  tree={TREE}"),
    ];

    assert_eq!(status(None).claim(), None);
    for description in odd {
        assert_eq!(status(Some(&description)).claim(), None, "{description}");
    }
}

#[test]
fn writes_a_description_it_can_read_back() {
    let plain = description("0123456789abcdef", TREE, None);
    let noted = description("0123456789abcdef", TREE, Some(&"long ".repeat(60)));

    assert_eq!(plain, format!("fp=0123456789abcdef tree={TREE}"));
    assert_eq!(noted.chars().count(), DESCRIPTION_LIMIT);
    assert!(status(Some(&plain)).claim().is_some());
    assert!(status(Some(&noted)).claim().is_some());
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

    let statuses: Vec<Status> = serde_json::from_str(
        r#"[{"context": "CI gate", "state": "pending", "description": null, "id": 1}]"#,
    )
    .expect("statuses");
    assert_eq!(statuses[0].description, None);
}
