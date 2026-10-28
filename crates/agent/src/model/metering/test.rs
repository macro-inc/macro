use super::*;
use serde_json::json;

fn profile(protocol: WireProtocol) -> ProviderSupport {
    ProviderSupport {
        model: ProviderModel::new("test", "model").unwrap(),
        protocol,
        input_token_ceiling: 100,
        output_token_ceiling: 20,
        zero_usage_is_missing: false,
    }
}

#[test]
fn clamps_wire_output_limit_before_authorization() {
    for (protocol, mut body, pointer) in [
        (
            WireProtocol::Anthropic,
            json!({"max_tokens": 50}),
            "/max_tokens",
        ),
        (
            WireProtocol::Responses,
            json!({"max_output_tokens": 50}),
            "/max_output_tokens",
        ),
        (
            WireProtocol::ChatCompletions,
            json!({"max_tokens": 50}),
            "/max_tokens",
        ),
        (
            WireProtocol::Gemini,
            json!({"generationConfig": {"maxOutputTokens": 50}}),
            "/generationConfig/maxOutputTokens",
        ),
    ] {
        let budget = profile(protocol).constrain(&mut body).unwrap();
        assert_eq!(body.pointer(pointer).unwrap(), 20);
        assert_eq!(budget.input(), 100);
        assert_eq!(budget.output(), 20);
    }
}

#[test]
fn unsupported_multiplicity_and_missing_limits_fail_closed() {
    let support = profile(WireProtocol::ChatCompletions);
    assert!(
        support
            .constrain(&mut json!({"max_tokens": 20, "n": 2}))
            .is_err()
    );
    assert!(support.constrain(&mut json!({})).is_err());
    assert!(support.constrain(&mut json!({"max_tokens": 0})).is_err());
}

#[tokio::test]
async fn request_scopes_do_not_share_attribution() {
    let first = MeteringContext::new(
        FinancialMode::Activated,
        FinancialCapability::Unavailable,
        UsageContext::system(ai_usage::AiFeature::Chat),
        vec![],
    );
    let second = MeteringContext::new(
        FinancialMode::Legacy,
        FinancialCapability::Unavailable,
        UsageContext::system(ai_usage::AiFeature::Memory),
        vec![],
    );
    let a = first.run_id;
    let b = second.run_id;
    tokio::join!(
        first.scope(async {
            tokio::task::yield_now().await;
            assert_eq!(MeteringContext::current().unwrap().run_id, a);
        }),
        second.scope(async {
            tokio::task::yield_now().await;
            assert_eq!(MeteringContext::current().unwrap().run_id, b);
        })
    );
    assert!(MeteringContext::current().is_none());
}

#[test]
fn gemini_installs_the_limit_rig_omits_without_generation_config() {
    let mut body = json!({"generationConfig": null, "tools": [{"functionDeclarations": [], "codeExecution": null}]});
    profile(WireProtocol::Gemini).constrain(&mut body).unwrap();
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 20);
}

#[test]
fn unverified_modalities_server_tools_and_cache_ttls_fail_closed() {
    for mut body in [
        json!({"max_tokens": 20, "messages": [{"content": [{"type":"image","source":{}}]}]}),
        json!({"max_tokens": 20, "tools": [{"type":"web_search_20250305"}]}),
        json!({"max_tokens": 20, "system": [{"type":"text","text":"hello","cache_control":{"type":"ephemeral","ttl":"1h"}}]}),
        json!({"max_tokens": 20, "thinking": {"budget_tokens": 25}}),
    ] {
        assert!(
            profile(WireProtocol::Anthropic)
                .constrain(&mut body)
                .is_err()
        );
    }
}
