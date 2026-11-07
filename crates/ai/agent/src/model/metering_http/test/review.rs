use super::*;

#[test]
fn nullable_anthropic_counters_are_absent_but_required_and_malformed_counts_are_not() {
    assert_eq!(
        normalize(
            WireProtocol::Anthropic,
            &json!({
                "input_tokens": 10, "output_tokens": 2, "cache_creation": null,
                "cache_read_input_tokens": null, "cache_creation_input_tokens": null
            })
        ),
        Some(TrustedTokenUsage::from_disjoint(10, 2, 0, 0, 0))
    );
    for usage in [
        json!({"input_tokens": 10}),
        json!({"input_tokens": 10, "output_tokens": null}),
        json!({"input_tokens": 10, "output_tokens": 2, "cache_creation": 3}),
        json!({"input_tokens": 10, "output_tokens": 2, "cache_read_input_tokens": -1}),
        json!({"input_tokens": 10, "output_tokens": 2, "cache_creation_input_tokens": "3"}),
    ] {
        assert!(normalize(WireProtocol::Anthropic, &usage).is_none());
    }
    let mut facts = Facts::new(WireProtocol::Anthropic, false, None);
    facts.event(br#"{"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}}}"#);
    facts.event(br#"{"type":"message_delta","usage":{"input_tokens":null,"output_tokens":7,"cache_read_input_tokens":null,"cache_creation_input_tokens":null,"cache_creation":null}}"#);
    facts.event(br#"{"type":"message_delta","usage":{"output_tokens":null}}"#);
    facts.event(br#"{"type":"message_stop"}"#);
    assert_eq!(
        facts.evidence(),
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 7, 3, 2, 0))
    );
}

const SSE: &str = concat!(
    "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10}}}\n\n",
    "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":7}}\n\n",
    "data: {\"type\":\"message_stop\"}\n\n",
);

#[tokio::test(start_paused = true)]
async fn live_stream_outlives_drain_budget_without_truncation() {
    let journal = Arc::new(Journal::default());
    let client = MeteredHttpClient::new(
        Transport {
            stall: true,
            connect_delay: DRAIN_TIMEOUT * 2,
            ..Transport::new(SSE)
        },
        "anthropic",
        WireProtocol::Anthropic,
    );
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    )
    .scope(async {
        let mut stream = client.send_streaming(request()).await.unwrap().into_body();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            bytes.extend_from_slice(&chunk.unwrap());
        }
        assert_eq!(bytes, SSE.as_bytes());
    })
    .await;
    assert_eq!(
        journal.finals.lock().unwrap()[0].usage,
        UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(10, 7, 0, 0, 0))
    );
}

#[tokio::test(start_paused = true)]
async fn dropped_stream_has_a_bounded_drain_and_interrupted_evidence() {
    let journal = Arc::new(Journal::default());
    let client = MeteredHttpClient::new(
        Transport {
            stall: true,
            ..Transport::new(SSE)
        },
        "anthropic",
        WireProtocol::Anthropic,
    );
    context(
        journal.clone(),
        WireProtocol::Anthropic,
        "anthropic",
        "model",
    )
    .scope(async {
        drop(client.send_streaming(request()).await.unwrap());
    })
    .await;
    tokio::task::yield_now().await;
    tokio::time::advance(DRAIN_TIMEOUT + Duration::from_secs(1)).await;
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        journal.finals.lock().unwrap()[0].usage,
        UsageEvidence::Missing(UnresolvedReason::Interrupted)
    );
}

#[tokio::test(start_paused = true)]
async fn cancellation_before_stream_headers_shares_one_drain_budget_with_body() {
    for connect_delay in [Duration::from_secs(200), DRAIN_TIMEOUT * 2] {
        let journal = Arc::new(Journal::default());
        let transport = Transport {
            connect_delay,
            stall: true,
            ..Transport::new(SSE)
        };
        let client =
            MeteredHttpClient::new(transport.clone(), "anthropic", WireProtocol::Anthropic);
        let scope = context(
            journal.clone(),
            WireProtocol::Anthropic,
            "anthropic",
            "model",
        );
        let caller =
            tokio::spawn(async move { scope.scope(client.send_streaming(request())).await });
        while transport.calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
        caller.abort();
        let _ = caller.await;
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(201)).await;
        for _ in 0..20 {
            tokio::task::yield_now().await;
        }
        assert!(journal.finals.lock().unwrap().is_empty());
        tokio::time::advance(Duration::from_secs(100)).await;
        for _ in 0..20 {
            tokio::task::yield_now().await;
        }
        assert_eq!(
            journal.finals.lock().unwrap()[0].usage,
            UsageEvidence::Missing(UnresolvedReason::Interrupted)
        );
    }
}

#[tokio::test]
async fn mixed_session_scopes_preserve_identity_and_new_financial_activation() {
    use rig_core::test_utils::{MockCompletionModel, MockStreamEvent};
    let owner = UsageContext::new(
        AiFeature::Chat,
        "macro|owner@example.com".to_owned().try_into().unwrap(),
    );
    let other = UsageContext::new(
        AiFeature::Chat,
        "macro|other@example.com".to_owned().try_into().unwrap(),
    );
    for stored_mode in [FinancialMode::Activated, FinancialMode::TrackingOnly] {
        for current_mode in [
            FinancialMode::Activated,
            FinancialMode::TrackingOnly,
            FinancialMode::Legacy,
        ] {
            let journal = Arc::new(Journal::default());
            let stored = MeteringContext::new(
                stored_mode,
                FinancialCapability::Available(journal.clone()),
                owner.clone(),
                vec![],
            );
            let current = MeteringContext::new(
                current_mode,
                FinancialCapability::Available(journal),
                other.clone(),
                vec![],
            );
            let agent = crate::AgentLoop::new(Arc::new(ai_usage::NoOpUsageRecorder));
            let mut session = stored
                .scope(agent.test_session(
                    Arc::new(ai_toolset::AsyncToolCollection::<()>::new()),
                    Arc::new(()),
                    "system",
                    owner.clone(),
                    MockCompletionModel::from_stream_turns([vec![
                        MockStreamEvent::text("done"),
                        MockStreamEvent::final_response_with_default_usage(),
                    ]]),
                ))
                .await;
            let result = current
                .scope(session.send_message(vec![rig_core::message::Message::user("hello")]))
                .await;
            if current_mode == FinancialMode::Activated {
                assert!(result.err().unwrap().to_string().contains("attribution"));
            } else {
                let mut stream = result.unwrap();
                while let Some(item) = stream.next().await {
                    item.unwrap();
                }
            }
        }
    }
}
