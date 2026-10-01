use super::*;
use ai_billing::{AdmissionFuture, AiAdmissionError, DenyReason};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Admission {
    result: std::result::Result<(), AiAdmissionError>,
    calls: AtomicUsize,
}

impl Admission {
    fn new(result: std::result::Result<(), AiAdmissionError>) -> Arc<Self> {
        Arc::new(Self {
            result,
            calls: AtomicUsize::new(0),
        })
    }
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        caller: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        // The sender, not the existing session's different owner, pays for inference.
        assert_eq!(caller, &user());
        assert_eq!(feature, AiFeature::Automation);
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { self.result })
    }
}

fn failures() -> [AiAdmissionError; 2] {
    [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Unavailable,
    ]
}

#[tokio::test]
async fn rejection_skips_the_entire_judge_including_image_preparation_and_acks() {
    for failure in failures() {
        for with_image in [false, true] {
            let mut posted = message(vec![]);
            if with_image {
                posted
                    .attachments
                    .push(messages::domain::events::MessageEventAttachment {
                        attachment_id: Uuid::from_u128(5),
                        entity_type: "static_image".to_owned(),
                        entity_id: "image-to-caption".to_owned(),
                        created_at: Utc::now(),
                    });
            }
            let sessions =
                implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
            let admission = Admission::new(Err(failure));
            let service = service(
                sessions,
                agent_bots(),
                extractor(Ok(None)),
                MockImplicitTriggerJudge::new(),
            )
            .with_admission(admission.clone());
            assert!(
                service
                    .evaluate(&posted)
                    .await
                    .expect("ack optional inference")
                    .is_empty()
            );
            assert_eq!(admission.calls.load(Ordering::SeqCst), 1);
        }
    }
}

#[tokio::test]
async fn explicit_mentions_and_reply_targets_route_without_admission() {
    for failure in failures() {
        let admission = Admission::new(Err(failure));
        let (replies, judge) = no_implicit();
        let mention_service = service(sessions_without_existing(), agent_bots(), replies, judge)
            .with_admission(admission.clone());
        assert_eq!(
            mention_service
                .evaluate(&message(vec![mention_of(BotId::TEST_A)]))
                .await
                .unwrap()
                .len(),
            1
        );
        assert_eq!(admission.calls.load(Ordering::SeqCst), 0);

        let sessions =
            implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
        let service = super::service(
            sessions,
            agent_bots(),
            extractor(Ok(Some(reply_to_bot(BotId::TEST_A)))),
            MockImplicitTriggerJudge::new(),
        )
        .with_admission(admission.clone());
        let events = service.evaluate(&message(vec![])).await.unwrap();
        assert_eq!(
            existing_channel_metadata(&events).kind,
            ThreadMessageKind::ExplicitReply
        );
        assert_eq!(admission.calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn admitted_inference_uses_the_sender_and_does_not_retry_a_failed_judge() {
    for outcome in [
        Ok(true),
        Err(AgentSessionError::Unknown(anyhow::anyhow!(
            "provider failed"
        ))),
    ] {
        let expected = outcome.is_ok();
        let admission = Admission::new(Ok(()));
        let sessions =
            implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
        let service = service(
            sessions,
            agent_bots(),
            extractor(Ok(None)),
            judge_saying(outcome),
        )
        .with_admission(admission.clone());
        let events = service.evaluate(&message(vec![])).await.unwrap();
        assert_eq!(!events.is_empty(), expected);
        assert_eq!(admission.calls.load(Ordering::SeqCst), 1);
    }
}
