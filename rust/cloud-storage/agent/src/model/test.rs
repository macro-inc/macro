use super::*;

#[test]
fn retired_model_deserializes_to_retired() {
    let m: AgentModel = serde_json::from_str(r#""claude-opus-4-6""#).unwrap();
    assert_eq!(m, AgentModel::Retired);
}

#[test]
fn smart_deserializes() {
    let m: AgentModel = serde_json::from_str(r#""smart""#).unwrap();
    assert_eq!(m, AgentModel::Smart);
}

#[test]
fn fast_deserializes() {
    let m: AgentModel = serde_json::from_str(r#""fast""#).unwrap();
    assert_eq!(m, AgentModel::Fast);
}

#[test]
fn smart_routes_to_opus() {
    assert_eq!(AgentModel::Smart.api_id(), AgentModel::Opus4_7.api_id());
}

#[test]
fn fast_routes_to_haiku() {
    assert_eq!(AgentModel::Fast.api_id(), AgentModel::Haiku4_5.api_id());
}

#[test]
fn retired_google_model_falls_back() {
    let m: AgentModel = serde_json::from_str(r#""gemini-2.5-pro""#).unwrap();
    assert_eq!(m, AgentModel::Retired);
}

#[test]
fn retired_openai_model_falls_back() {
    let m: AgentModel = serde_json::from_str(r#""gpt-4o""#).unwrap();
    assert_eq!(m, AgentModel::Retired);
}

#[test]
fn retired_uses_default_api_id() {
    assert_eq!(AgentModel::Retired.api_id(), AgentModel::Smart.api_id());
}

#[test]
fn gpt5_5_deserializes() {
    let m: AgentModel = serde_json::from_str(r#""gpt5_5""#).unwrap();
    assert_eq!(m, AgentModel::Gpt5_5);
}

#[test]
fn gpt5_mini_deserializes() {
    let m: AgentModel = serde_json::from_str(r#""gpt5Mini""#).unwrap();
    assert_eq!(m, AgentModel::Gpt5Mini);
}

#[test]
fn gpt_models_route_to_openai() {
    assert_eq!(AgentModel::Gpt5_5.provider(), ModelProvider::OpenAi);
    assert_eq!(AgentModel::Gpt5Mini.provider(), ModelProvider::OpenAi);
    assert_eq!(AgentModel::Smart.provider(), ModelProvider::Anthropic);
    assert_eq!(AgentModel::Retired.provider(), ModelProvider::Anthropic);
}

#[test]
fn gpt_round_trip_serialization() {
    for m in [AgentModel::Gpt5_5, AgentModel::Gpt5Mini] {
        let json = serde_json::to_string(&m).unwrap();
        let back: AgentModel = serde_json::from_str(&json).unwrap();
        assert_eq!(back, m);
    }
}

#[test]
fn round_trip_serialization() {
    let m = AgentModel::Sonnet4_6;
    let json = serde_json::to_string(&m).unwrap();
    assert_eq!(json, r#""sonnet4_6""#);
    let back: AgentModel = serde_json::from_str(&json).unwrap();
    assert_eq!(back, m);
}

#[test]
fn default_is_smart() {
    assert_eq!(AgentModel::default(), AgentModel::Smart);
}
