use super::*;
use crate::domain::observation::Change;
use crate::outbound::test_support::start;

#[tokio::test]
async fn a_manager_reports_goal_state_and_its_latest_verdict() {
    let dir = tempfile::tempdir().expect("tempdir");
    let manager = dir.path().join("t1-100");
    std::fs::create_dir_all(manager.join("reviews")).expect("mkdir");
    std::fs::write(manager.join("goal.md"), "\nShip the widget\nwith tests\n").expect("write");
    std::fs::write(manager.join("reviews/1.verdict"), "fail\n2 must-fix\n").expect("write");
    std::fs::write(manager.join("reviews/1.md"), "findings").expect("write");
    let mut source = start(Box::new(ManagersSource::new(dir.path().to_owned())));

    let changes = source.until_ready().await;
    assert_eq!(
        changes[0],
        Change::Reset(vec![Fact::Manager(ManagerFact {
            dir: manager.clone(),
            goal: Some("Ship the widget".to_owned()),
            state: None,
            reviews: 1,
            last_verdict: Some("fail".to_owned()),
            prs: Vec::new(),
        })])
    );

    std::fs::write(manager.join("reviews/10.verdict"), "pass\n").expect("write");
    std::fs::write(manager.join("reviews/2.verdict"), "fail\n").expect("write");
    std::fs::write(manager.join("state"), "done\n").expect("write");
    let mut latest = None;
    while latest
        .as_ref()
        .is_none_or(|fact: &ManagerFact| fact.reviews < 3 || fact.state.is_none())
    {
        match source.next_fact().await {
            Change::Upsert(Fact::Manager(fact)) => latest = Some(fact),
            other => panic!("expected a manager upsert, got {other:?}"),
        }
    }
    let latest = latest.expect("an update");
    assert_eq!(latest.last_verdict.as_deref(), Some("pass"));
    assert_eq!(latest.state.as_deref(), Some("done"));

    source.stop().await;
}

#[test]
fn a_prs_file_lists_each_recorded_pull_request_once_in_order() {
    let dir = tempfile::tempdir().expect("tempdir");
    let manager = dir.path().join("t2-200");
    std::fs::create_dir_all(&manager).expect("mkdir");
    std::fs::write(
        manager.join("prs"),
        "https://github.com/example-org/widgets/pull/12\n\nnot a url\n\
         https://github.com/example-org/gadgets/pull/3\n\
         https://github.com/example-org/widgets/pull/12\n",
    )
    .expect("write");

    let source = ManagersSource::new(dir.path().to_owned());
    let Some(Fact::Manager(fact)) = source.read(&manager) else {
        panic!("expected a manager fact");
    };
    let repo = |name: &str| crate::domain::model::RepoName::parse(name).expect("repo");
    assert_eq!(
        fact.prs,
        vec![
            PrRef {
                repo: repo("example-org/widgets"),
                number: 12
            },
            PrRef {
                repo: repo("example-org/gadgets"),
                number: 3
            },
        ]
    );
}
