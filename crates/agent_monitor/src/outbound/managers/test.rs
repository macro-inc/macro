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
