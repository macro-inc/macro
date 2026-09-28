use super::*;
use ai_usage::{TrackedInvocation, UsageTracking};

#[derive(Default)]
struct Observations {
    begins: Mutex<Vec<TrackedInvocation>>,
    finals: Mutex<Vec<FinalizeInvocation>>,
    fail: bool,
    lose_ack: bool,
}

impl UsageTracking for Observations {
    fn begin(&self, request: TrackedInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async move {
            let mut begins = self.begins.lock().unwrap();
            if !begins
                .iter()
                .any(|r| r.invocation_id == request.invocation_id)
            {
                begins.push(request);
            }
            if self.fail {
                return Err(FinancialError::CapabilityUnavailable);
            }
            Ok(WriteDisposition::Inserted)
        })
    }

    fn finalize(&self, evidence: FinalizeInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async move {
            let mut finals = self.finals.lock().unwrap();
            finals.push(evidence);
            if self.lose_ack && finals.len() == 1 {
                return Err(FinancialError::CapabilityUnavailable);
            }
            Ok(WriteDisposition::Inserted)
        })
    }
}

fn usage(user: &str, feature: AiFeature) -> UsageContext {
    UsageContext::new(feature, user.to_owned().try_into().unwrap())
}

#[tokio::test]
async fn no_funding_or_rates_are_required_and_request_budgets_are_unchanged() {
    let journal = Arc::new(Observations::default());
    // No financial capability, funding authorization or provider support profile.
    let context = MeteringContext::tracking_only(
        journal.clone(),
        usage("macro|opted-out@example.com", AiFeature::Chat),
    );
    let transport = Transport::new(anthropic_response());
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    let body = json!({"model":"model", "max_tokens":50, "tools":[{"type":"web_search"}],
        "messages":[{"content":[{"type":"image","source":{}}]}]});
    context
        .scope(async {
            for _ in 0..2 {
                let request = Request::builder()
                    .uri("https://example.test/messages")
                    .body(Bytes::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap();
                client
                    .send::<_, Bytes>(request)
                    .await
                    .unwrap()
                    .into_body()
                    .await
                    .unwrap();
            }
        })
        .await;
    assert_eq!(*transport.bodies.lock().unwrap(), vec![body.clone(), body]);
    let begins = journal.begins.lock().unwrap();
    assert_eq!(begins.len(), 2);
    assert_ne!(begins[0].invocation_id, begins[1].invocation_id);
    assert_eq!(begins[0].run_id, begins[1].run_id);
    let finals = journal.finals.lock().unwrap();
    assert_eq!(finals.len(), 2);
    assert_eq!(
        finals[0].usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 5, 2, 3, 0))
    );
}

#[tokio::test]
async fn concurrent_users_and_excluded_features_keep_immutable_attribution() {
    let journal = Arc::new(Observations::default());
    let client = MeteredHttpClient::new(
        Transport::new(anthropic_response()),
        "anthropic",
        WireProtocol::Anthropic,
    );
    let a = MeteringContext::tracking_only(
        journal.clone(),
        usage("macro|a@example.com", AiFeature::ChatRename),
    );
    let b = MeteringContext::tracking_only(
        journal.clone(),
        usage("macro|b@example.com", AiFeature::Import),
    );
    let (a, b) = tokio::join!(
        a.scope(client.send::<_, Bytes>(request())),
        b.scope(client.send::<_, Bytes>(request())),
    );
    a.unwrap();
    b.unwrap();
    let begins = journal.begins.lock().unwrap();
    assert_eq!(begins.len(), 2);
    assert!(begins.iter().any(|r| r.user.as_ref() == "macro|a@example.com" && r.feature == AiFeature::ChatRename));
    assert!(
        begins
            .iter()
            .any(|r| r.user.as_ref() == "macro|b@example.com" && r.feature == AiFeature::Import)
    );
    assert_ne!(begins[0].run_id, begins[1].run_id);
}

#[tokio::test]
async fn recorder_failure_never_becomes_denial_or_stops_later_attempts() {
    let journal = Arc::new(Observations {
        fail: true,
        ..Default::default()
    });
    let context = MeteringContext::tracking_only(
        journal.clone(),
        usage("macro|exhausted@example.com", AiFeature::Chat),
    );
    let transport = Transport::new(anthropic_response());
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    context
        .scope(async {
            for _ in 0..2 {
                let response = client.send::<_, Bytes>(request()).await.unwrap();
                assert_eq!(response.into_body().await.unwrap(), anthropic_response());
            }
        })
        .await;
    assert_eq!(transport.calls.load(Ordering::SeqCst), 2);
    assert!(journal.finals.lock().unwrap().is_empty());
}

#[tokio::test]
async fn lost_ack_retries_identical_evidence_not_the_provider() {
    let journal = Arc::new(Observations {
        lose_ack: true,
        ..Default::default()
    });
    let context =
        MeteringContext::tracking_only(journal.clone(), UsageContext::system(AiFeature::Chat));
    let transport = Transport::new(anthropic_response());
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    context
        .scope(client.send::<_, Bytes>(request()))
        .await
        .unwrap();
    assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
    let finals = journal.finals.lock().unwrap();
    assert_eq!(finals.len(), 2);
    assert_eq!(finals[0], finals[1]);
}

#[tokio::test]
async fn interrupted_stream_is_unresolved_without_adding_a_provider_error() {
    let journal = Arc::new(Observations::default());
    let context =
        MeteringContext::tracking_only(journal.clone(), UsageContext::system(AiFeature::Chat));
    let client = MeteredHttpClient::new(
        Transport::new("data: {\"type\":\"message_start\",\"message\":{}}\n\n"),
        "anthropic",
        WireProtocol::Anthropic,
    );
    context
        .scope(async {
            let response = client.send_streaming(request()).await.unwrap();
            let chunks: Vec<_> = response.into_body().collect().await;
            assert!(chunks.iter().all(Result::is_ok));
        })
        .await;
    assert_eq!(
        journal.finals.lock().unwrap()[0].usage,
        UsageEvidence::Missing(UnresolvedReason::Interrupted)
    );
}

#[tokio::test(start_paused = true)]
async fn caller_cancellation_does_not_cancel_evidence_delivery() {
    let journal = Arc::new(Observations::default());
    let context = MeteringContext::tracking_only(
        journal.clone(),
        UsageContext::system(AiFeature::ChannelBot),
    );
    let transport = Transport {
        stall: true,
        ..Transport::new(anthropic_response())
    };
    let client = MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
    let caller =
        tokio::spawn(async move { context.scope(client.send::<_, Bytes>(request())).await });
    while transport.calls.load(Ordering::SeqCst) == 0 {
        tokio::task::yield_now().await;
    }
    caller.abort();
    tokio::time::advance(EXECUTION_TIMEOUT + Duration::from_secs(1)).await;
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        journal.finals.lock().unwrap()[0].usage,
        UsageEvidence::Missing(UnresolvedReason::Interrupted)
    );
}

#[tokio::test]
async fn captured_financial_session_cannot_be_downgraded_by_an_observational_recorder() {
    use rig_core::test_utils::{MockCompletionModel, MockTurn};
    let recorder = ai_usage::with_tracking(
        Arc::new(ai_usage::NoOpUsageRecorder),
        Arc::new(Observations::default()),
    );
    let usage = UsageContext::system(AiFeature::Chat);
    let strict = MeteringContext::new(
        FinancialMode::Activated,
        FinancialCapability::Unavailable,
        usage.clone(),
        vec![],
    );
    let agent = crate::AgentLoop::new(recorder);
    let mut session = strict
        .scope(agent.test_session(
            Arc::new(ai_toolset::AsyncToolCollection::<()>::new()),
            Arc::new(()),
            "system",
            usage,
            MockCompletionModel::new([MockTurn::text("must not execute")]),
        ))
        .await;
    let error = session
        .send_message(vec![rig_core::message::Message::user("hello")])
        .await
        .err()
        .expect("captured strict scope must fail closed");
    assert!(error.to_string().contains("capability"));
}

#[tokio::test]
async fn legacy_scope_does_not_disable_injected_observation_and_children_can_inherit_it() {
    let journal = Arc::new(Observations::default());
    let recorder = ai_usage::with_tracking(Arc::new(ai_usage::NoOpUsageRecorder), journal.clone());
    let parent_usage = usage("macro|a@example.com", AiFeature::Chat);
    let child_usage = usage("macro|b@example.com", AiFeature::ChatRename);
    let legacy = MeteringContext::new(
        FinancialMode::Legacy,
        FinancialCapability::Unavailable,
        parent_usage.clone(),
        vec![],
    );
    legacy
        .scope(async {
            let parent = MeteringContext::for_operation(recorder.as_ref(), &parent_usage).unwrap();
            parent
                .scope(async {
                    let child =
                        MeteringContext::for_operation(&ai_usage::NoOpUsageRecorder, &child_usage)
                            .unwrap();
                    child
                        .scope(async {
                            let client = MeteredHttpClient::new(
                                Transport::new(anthropic_response()),
                                "anthropic",
                                WireProtocol::Anthropic,
                            );
                            client.send::<_, Bytes>(request()).await.unwrap();
                        })
                        .await;
                })
                .await;
        })
        .await;
    assert_eq!(journal.begins.lock().unwrap()[0].user, child_usage.user);
    assert_eq!(
        journal.begins.lock().unwrap()[0].feature,
        AiFeature::ChatRename
    );
}

#[tokio::test]
async fn scope_bridge_preserves_financial_mode_and_rebinds_observational_children() {
    let journal = Arc::new(Observations::default());
    let recorder = ai_usage::with_tracking(Arc::new(ai_usage::NoOpUsageRecorder), journal.clone());
    let parent_usage = usage("macro|a@example.com", AiFeature::Automation);
    let child_usage = usage("macro|b@example.com", AiFeature::Import);
    let parent = MeteringContext::for_operation(recorder.as_ref(), &parent_usage).unwrap();
    let client = MeteredHttpClient::new(
        Transport::new(anthropic_response()),
        "anthropic",
        WireProtocol::Anthropic,
    );
    parent
        .scope(async {
            let child = MeteringContext::for_operation(recorder.as_ref(), &child_usage).unwrap();
            let captured = Some(child);
            tokio::spawn(MeteringContext::carry(captured, async move {
                client.send::<_, Bytes>(request()).await
            }))
            .await
            .unwrap()
            .unwrap();
        })
        .await;
    assert_eq!(journal.begins.lock().unwrap()[0].user, child_usage.user);
    let strict = MeteringContext::new(
        FinancialMode::Activated,
        FinancialCapability::Unavailable,
        parent_usage,
        vec![],
    );
    strict
        .scope(async {
            assert!(
                MeteringContext::for_operation(recorder.as_ref(), &child_usage)
                    .unwrap()
                    .activated()
            );
            assert!(MeteringContext::require_usage(&child_usage).is_err());
        })
        .await;
}
