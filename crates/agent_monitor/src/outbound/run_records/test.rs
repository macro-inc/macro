use super::*;
use crate::domain::observation::Change;
use crate::outbound::test_support::start;

const DAY: Duration = Duration::from_secs(24 * 60 * 60);

fn record(id: &str, status: &str, started: &str) -> String {
    format!(
        r#"{{"id":"{id}","task":"Tidy the docs","label":"docs","status":"{status}","started":"{started}","pid":77,"herdr":{{"agent":"a","terminal":"t9"}}}}"#
    )
}

#[tokio::test]
async fn running_and_recent_runs_are_reported_with_their_cost_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let now = Utc::now();
    let recent = (now - chrono::TimeDelta::hours(1)).to_rfc3339();
    let old = (now - chrono::TimeDelta::days(3)).to_rfc3339();
    std::fs::write(dir.path().join("r1.json"), record("r1", "running", &old)).expect("write");
    std::fs::write(dir.path().join("r2.json"), record("r2", "done", &recent)).expect("write");
    std::fs::write(dir.path().join("r2.cost"), "1.5\n").expect("write");
    std::fs::write(dir.path().join("r3.json"), record("r3", "done", &old)).expect("write");
    std::fs::write(dir.path().join("r1.spec.md"), "not a record").expect("write");
    let mut source = start(Box::new(RunRecordsSource::new(
        vec![dir.path().to_owned()],
        DAY,
    )));

    let changes = source.until_ready().await;
    let Change::Reset(mut facts) = changes[0].clone() else {
        panic!("expected a reset, got {:?}", changes[0]);
    };
    facts.sort_by_key(Fact::key);
    assert_eq!(facts.len(), 2);
    let Fact::RunRecord(running) = &facts[0] else {
        panic!("expected a run record");
    };
    assert_eq!(running.id, "r1");
    assert_eq!(running.terminal.as_deref(), Some("t9"));
    assert_eq!(running.pid, Some(77));
    assert_eq!(running.cost, None);
    let Fact::RunRecord(done) = &facts[1] else {
        panic!("expected a run record");
    };
    assert_eq!(done.cost, Some(Cost::Known(1.5)));

    // Writing the cost file re-reads its record.
    std::fs::write(dir.path().join("r1.cost"), "0.25").expect("write");
    match source.next_fact().await {
        Change::Upsert(Fact::RunRecord(run)) => {
            assert_eq!(run.id, "r1");
            assert_eq!(run.cost, Some(Cost::Known(0.25)));
        }
        other => panic!("expected a run upsert, got {other:?}"),
    }

    source.stop().await;
}
