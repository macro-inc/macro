use crate::model::anthropic::is_anthropic_model;
use crate::model::openai::is_openai_model;

#[test]
fn matches_gpt_family() {
    for id in [
        "gpt-5",
        "gpt-5-mini",
        "gpt-5-nano",
        "gpt-5.1",
        "gpt-5.5",
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4.1",
        "gpt-4-turbo",
        "gpt-4",
        "gpt-3.5-turbo",
    ] {
        assert!(is_openai_model(id), "{id} should match");
    }
}

#[test]
fn matches_o_series() {
    for id in [
        "o1", "o1-mini", "o1-pro", "o3", "o3-mini", "o3-pro", "o4-mini",
    ] {
        assert!(is_openai_model(id), "{id} should match");
    }
}

#[test]
fn matches_chat_aliases() {
    assert!(is_openai_model("chatgpt-4o-latest"));
    assert!(is_openai_model("chat-latest"));
}

#[test]
fn rejects_anthropic_models() {
    for id in [
        "claude-opus-4-8",
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
        "claude-fable-5",
        "fable",
        "mythos",
    ] {
        assert!(!is_openai_model(id), "{id} should not match");
    }
}

#[test]
fn rejects_empty_and_unrelated() {
    assert!(!is_openai_model(""));
    assert!(!is_openai_model("gemini-2.5-pro"));
    // Anchored at the start: a string merely containing "gpt-" doesn't match.
    assert!(!is_openai_model("my-gpt-5"));
}

#[test]
fn matches_anthropic_models() {
    for id in [
        "claude-opus-4-8",
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
        "claude-fable-5",
    ] {
        assert!(is_anthropic_model(id), "{id} should match");
    }
}

#[test]
fn anthropic_and_openai_namespaces_are_disjoint() {
    for id in ["gpt-5", "o3-mini", "chatgpt-4o-latest", "chat-latest"] {
        assert!(is_openai_model(id) && !is_anthropic_model(id), "{id}");
    }
    for id in ["claude-opus-4-8", "claude-haiku-4-5"] {
        assert!(is_anthropic_model(id) && !is_openai_model(id), "{id}");
    }
}

#[test]
fn anthropic_rejects_unrelated() {
    assert!(!is_anthropic_model(""));
    assert!(!is_anthropic_model("gpt-5"));
    assert!(!is_anthropic_model("gemini-2.5-pro"));
    // Anchored: bare family names without the `claude-` prefix don't match.
    assert!(!is_anthropic_model("opus"));
}
