use super::*;

/// The opening model these cases run with.
const FAST: &str = DEFAULT_FIRST_TURN_MODEL;

const CATALOG: &[&str] = &[
    "anthropic/claude-sonnet-5",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-5-mini",
];

#[test]
fn an_opening_turn_on_an_unchosen_model_runs_on_the_fast_one() {
    assert_eq!(
        first_turn_model(true, false, "anthropic/claude-sonnet-5", CATALOG, FAST),
        Some(FAST.to_owned())
    );
}

#[test]
fn every_later_turn_runs_on_the_session_model() {
    assert_eq!(
        first_turn_model(false, false, "anthropic/claude-sonnet-5", CATALOG, FAST),
        None
    );
}

#[test]
fn a_model_the_caller_chose_answers_their_first_prompt_too() {
    assert_eq!(
        first_turn_model(true, true, "anthropic/claude-sonnet-5", CATALOG, FAST),
        None
    );
}

#[test]
fn a_session_already_on_the_fast_model_substitutes_nothing() {
    assert_eq!(first_turn_model(true, false, FAST, CATALOG, FAST), None);
}

#[test]
fn a_model_the_engine_does_not_serve_is_never_substituted_in() {
    assert_eq!(
        first_turn_model(
            true,
            false,
            "anthropic/claude-sonnet-5",
            &["only/this"],
            FAST
        ),
        None
    );
}

#[test]
fn the_default_opening_model_is_one_the_catalog_serves() {
    assert!(
        chat::domain::models::CHAT_MODELS.contains(&DEFAULT_FIRST_TURN_MODEL),
        "the default must be routable or every first turn silently falls back"
    );
    assert_eq!(configured_fast_model(), DEFAULT_FIRST_TURN_MODEL);
}
