use super::*;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tracing::{Instrument, instrument::WithSubscriber};

#[derive(Clone, Default)]
pub(super) struct Output(Arc<Mutex<Vec<u8>>>);
impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
pub(super) fn subscriber(output: &Output) -> impl tracing::Subscriber + Send + Sync + 'static {
    let output = output.clone();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .without_time()
        .with_ansi(false)
        .with_target(false)
        .with_writer(move || output.clone())
        .finish()
}
pub(super) fn lines(output: &Output) -> String {
    String::from_utf8(output.0.lock().unwrap().clone()).unwrap()
}

#[tokio::test]
async fn missing_link_emits_one_debug_event_with_the_link_in_the_processing_span() {
    let (svc, f) = setup();
    f.0.lock().unwrap().link = None;
    let output = Output::default();
    svc.process(&crm_population())
        .with_subscriber(subscriber(&output))
        .await;
    assert_eq!(
        lines(&output),
        format!(
            "DEBUG inner_process_message: Link was deleted; dropping link-scoped CRM message link_id={LINK}\n"
        )
    );
}

#[tokio::test]
async fn no_team_and_remaining_message_events_have_their_exact_operation_span() {
    for (msg, team, remaining, span, message) in [
        (
            crm_depopulation(),
            None,
            false,
            "depopulate_crm_contact",
            "User has no team; skipping CRM depopulation",
        ),
        (
            crm_depopulation(),
            Some(TEAM),
            true,
            "depopulate_crm_contact",
            "Link still has other messages with contact (sent or received); skipping depopulation",
        ),
    ] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            s.team = team;
            s.remaining_messages = remaining;
        }
        let output = Output::default();
        svc.process(&msg).with_subscriber(subscriber(&output)).await;
        assert_eq!(
            lines(&output),
            format!("DEBUG inner_process_message:{span}{{link_id={LINK}}}: {message}\n")
        );
    }
}

#[tokio::test]
async fn user_crm_skip_events_have_no_payload_fields() {
    for (msg, no_team, no_consent, span, fields, message) in [
        (
            population(),
            true,
            false,
            "populate_crm_for_user",
            String::new(),
            "User has no team; skipping CRM fan-out",
        ),
        (
            population(),
            false,
            true,
            "populate_crm_for_user",
            String::new(),
            "User has no consented mailbox; skipping CRM fan-out",
        ),
        (
            depopulation(),
            false,
            false,
            "depopulate_crm_for_user",
            format!("{{team_id={TEAM}}}"),
            "User has no email link; skipping CRM teardown",
        ),
    ] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            if no_team {
                s.team = None;
            }
            if no_consent {
                s.consent = false;
            }
            if span == "depopulate_crm_for_user" {
                s.link = None;
            }
        }
        let output = Output::default();
        svc.process(&msg).with_subscriber(subscriber(&output)).await;
        assert_eq!(
            lines(&output),
            format!("DEBUG inner_process_message:{span}{fields}: {message}\n")
        );
    }
}

#[tokio::test]
async fn each_refused_reason_emits_one_debug_event_with_its_error_chain_in_retry_span() {
    for reason in [
        FailureReason::BackfillWritesBusy,
        FailureReason::GmailApiRateLimited,
    ] {
        let output = Output::default();
        handle_retryable_error(
            &crm_population(),
            &DetailedError {
                reason,
                source: anyhow::anyhow!("inner").context("outer"),
            },
        )
        .with_subscriber(subscriber(&output))
        .await
        .unwrap();
        assert_eq!(
            lines(&output),
            format!(
                "DEBUG handle_retryable_error{{link_id=Some({LINK}) error=\"outer: inner\"}}: Refused backfill operation will be redelivered\n"
            )
        );
    }
}

#[tokio::test]
async fn successful_deferral_emits_one_debug_event_with_the_original_count_and_delay() {
    let (svc, _) = setup();
    let output = Output::default();
    let error = DetailedError {
        reason: FailureReason::BackfillWritesBusy,
        source: anyhow::anyhow!("busy"),
    };
    async {
        svc.defer(&crm_population(), &error, 2, Some(Duration::from_secs(31)))
            .instrument(tracing::debug_span!("defer_rate_limited_operation"))
            .await
            .unwrap();
    }
    .with_subscriber(subscriber(&output))
    .await;
    assert_eq!(
        lines(&output),
        "DEBUG defer_rate_limited_operation: Rate-limited backfill operation deferred deferrals=2 delay_seconds=31\n"
    );
}
