use super::*;

fn usd(cost: Cost) -> f64 {
    match cost {
        Cost::Estimated(usd) => usd,
        other => panic!("expected an estimate, got {other:?}"),
    }
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-9,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn five_minute_cache_writes_match_a_reported_session_cost() {
    // Usage and reported cost of one model in a synthetic Claude Code
    // cost-state record whose arithmetic matches the published rates.
    let tokens = Tokens {
        input: 148,
        output: 42_949,
        cache_read: 6_220_680,
        cache_write: 377_231,
        cache_write_1h: 0,
    };

    assert_close(usd(estimate(Some("claude-opus-5-5"), tokens)), 3.989_863);
}

#[test]
fn one_hour_cache_writes_cost_twice_input() {
    let tokens = Tokens {
        input: 48,
        output: 47_870,
        cache_read: 2_792_129,
        cache_write: 170_730,
        cache_write_1h: 170_730,
    };

    assert_close(usd(estimate(Some("claude-fable-5-2"), tokens)), 5.205_289_8);
}

#[test]
fn a_long_prompt_pays_the_long_context_rates_for_the_whole_request() {
    let short = Tokens {
        input: 100_000,
        output: 1_000,
        ..Tokens::default()
    };
    let long = Tokens {
        input: 100_001,
        output: 1_000,
        ..Tokens::default()
    };

    assert_close(usd(estimate(Some("claude-haiku-5-5"), short)), 0.0105);
    assert_close(usd(estimate(Some("claude-haiku-5-5"), long)), 0.0525005);
}

#[test]
fn cached_prompt_tokens_count_toward_the_long_context_threshold() {
    let tokens = Tokens {
        input: 2_000,
        cache_read: 271_000,
        ..Tokens::default()
    };

    assert_close(
        usd(estimate(Some("gpt-6-sol"), tokens)),
        (2_000.0 * 4.0 + 271_000.0 * 0.40) / 1_000_000.0,
    );
}

#[test]
fn snapshot_and_context_suffixes_resolve_to_the_base_model() {
    assert_eq!(
        price("claude-haiku-4-5-20251001"),
        price("claude-haiku-4-5")
    );
    assert_eq!(price("claude-opus-5-5[1m]"), price("claude-opus-5-5"));
}

#[test]
fn a_shorter_id_never_prices_a_different_model() {
    assert_ne!(price("claude-opus-5-5"), price("claude-opus-5"));
    assert_eq!(price("gpt-6-sol-pro"), None);
    assert_eq!(price("claude-opus-5-55"), None);
}

#[test]
fn an_unknown_or_missing_model_is_unpriced_not_free() {
    let tokens = Tokens {
        input: 10,
        output: 10,
        ..Tokens::default()
    };

    assert_eq!(estimate(Some("some-new-model"), tokens), Cost::Unpriced);
    assert_eq!(estimate(None, tokens), Cost::Unpriced);
}
