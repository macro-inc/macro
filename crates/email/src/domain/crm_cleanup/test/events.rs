use super::*;
use crm::domain::model::DepopulateContactOutcome;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tracing::instrument::WithSubscriber;

#[derive(Clone, Default)]
struct Output(Arc<Mutex<Vec<u8>>>);
impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn subscriber(output: &Output) -> impl tracing::Subscriber + Send + Sync + 'static {
    let output = output.clone();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .without_time()
        .with_ansi(false)
        .with_target(false)
        .with_writer(move || output.clone())
        .finish()
}
fn lines(output: &Output) -> String {
    String::from_utf8(output.0.lock().unwrap().clone()).unwrap()
}

#[tokio::test]
async fn every_moved_debug_event_keeps_its_exact_text_fields_and_operation_span() {
    for (branch, message) in [
        (
            "claimed",
            "Candidate row already claimed (duplicate dispatch or redelivery)",
        ),
        ("link", "Link no longer exists; skipping CRM cleanup"),
        ("team", "User has no team; skipping CRM cleanup"),
        (
            "target",
            "No CRM contact to tear down; skipping message scan",
        ),
        (
            "messages",
            "Link still has messages with contact (sent or received); skipping depopulation",
        ),
        (
            "outcome",
            "Nothing to tear down for contact; skipping depopulation",
        ),
    ] {
        let (service, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            match branch {
                "claimed" => s.claimed = false,
                "link" => s.link = None,
                "team" => s.team = None,
                "target" => s.target = false,
                "messages" => s.messages = true,
                "outcome" => s.outcome = DepopulateContactOutcome::default(),
                _ => unreachable!(),
            }
        }
        let output = Output::default();
        assert!(matches!(
            service
                .process(Ok(CrmCleanupOperation::ProcessCandidate {
                    link_id: LINK,
                    contact_email: EMAIL.into()
                }))
                .with_subscriber(subscriber(&output))
                .await,
            CrmCleanupDisposition::Delete
        ));
        let actual = lines(&output)
            .lines()
            .filter(|line| line.starts_with("DEBUG "))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(
            actual,
            [format!(
                "DEBUG inner_process_message:process_candidate{{link_id={LINK}}}: {message}"
            )]
        );
    }
}

#[tokio::test]
async fn each_removed_anything_condition_emits_the_exact_removal_fields() {
    for (source_deleted, contact_deleted, company_deleted) in [
        (true, false, false),
        (false, true, false),
        (false, false, true),
        (true, true, true),
        (false, false, false),
    ] {
        let (service, fake) = setup();
        fake.0.lock().unwrap().outcome = DepopulateContactOutcome {
            source_deleted,
            contact_deleted,
            company_deleted,
        };
        let output = Output::default();
        service
            .process(Ok(CrmCleanupOperation::ProcessCandidate {
                link_id: LINK,
                contact_email: EMAIL.into(),
            }))
            .with_subscriber(subscriber(&output))
            .await;
        if source_deleted || contact_deleted || company_deleted {
            assert_eq!(
                lines(&output),
                format!(
                    " INFO inner_process_message:process_candidate{{link_id={LINK}}}: Depopulated CRM contact team_id={TEAM} source_deleted={source_deleted} contact_deleted={contact_deleted} company_deleted={company_deleted}\n"
                )
            );
        } else {
            assert_eq!(
                lines(&output),
                format!(
                    "DEBUG inner_process_message:process_candidate{{link_id={LINK}}}: Nothing to tear down for contact; skipping depopulation\n"
                )
            );
        }
    }
}

#[tokio::test]
async fn completion_log_uses_fetched_count_even_when_the_increment_fails() {
    let (service, fake) = setup();
    fake.0.lock().unwrap().fault = Some(("count", 1));
    let output = Output::default();
    service
        .process(Ok(CrmCleanupOperation::ListCandidates {
            job_id: JOB,
            last_id: 0,
        }))
        .with_subscriber(subscriber(&output))
        .await;
    let rendered = lines(&output);
    let completion = rendered
        .lines()
        .find(|line| line.contains("Crm cleanup job dispatch complete"))
        .unwrap();
    assert!(completion.ends_with("dispatched=8"));
    assert_eq!(
        fake.calls()
            .iter()
            .filter(|c| matches!(c, Call::Job(_)))
            .count(),
        1
    );
}
