//! Background jobs announcing their state through the log.
use super::util::parse_log;
use crate::domain::lifecycle::LifecycleFold;
use crate::domain::model::{FoldEvent, TurnState};
use agent_runtime_protocol::domain::job::{JobStatus, JobUpdatedNotification};

#[test]
fn job_updates_project_each_jobs_latest_state_and_a_settled_job_stays_settled() {
    let log = parse_log(
        r#"
{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"Check the routine"}]}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"_macro/job_updated","params":{"jobId":"0192f7a0-0000-7000-8000-00000000000a","title":"Checking routine","status":"running"}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"_macro/job_updated","params":{"jobId":"0192f7a0-0000-7000-8000-00000000000a","title":"Checking routine","status":"done"}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"_macro/job_updated","params":{"jobId":"0192f7a0-0000-7000-8000-00000000000a","title":"Checking routine","status":"running"}}}
"#,
    );
    let mut machine = LifecycleFold::new();
    let _ = machine.push(log[0].clone());

    let started = machine.push(log[1].clone());
    assert!(matches!(
        started.events.as_slice(),
        [FoldEvent::MetadataUpdated(_)]
    ));
    let settled = machine.push(log[2].clone());
    assert!(matches!(
        settled.events.as_slice(),
        [FoldEvent::MetadataUpdated(_)]
    ));
    // A started frame logged after the settle is not news.
    assert!(machine.push(log[3].clone()).events.is_empty());

    assert_eq!(
        machine.inner().metadata().jobs,
        vec![JobUpdatedNotification {
            job_id: "0192f7a0-0000-7000-8000-00000000000a".parse().unwrap(),
            title: "Checking routine".into(),
            status: JobStatus::Done,
        }]
    );
    assert_eq!(machine.inner().metadata().turn, TurnState::Running);
    assert!(machine.inner().messages().len() <= 1);
}
