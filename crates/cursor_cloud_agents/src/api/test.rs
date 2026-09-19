//! Tests for client construction and, above all, for the key never being
//! printable.

use super::*;

const KEY: &str = "crsr_secret_do_not_print_me";

fn config() -> CursorConfig {
    CursorConfig {
        api_key: ApiKey::new(KEY),
        base_url: "https://api.cursor.test".to_owned(),
        model: None,
        starting_ref: "main".to_owned(),
        record_dir: None,
    }
}

/// The config derives `Debug`, so anything that logs it — `?config` on a
/// tracing event, a `{:?}` in an error path — used to write a live credential
/// to the user's log file.
#[test]
fn debug_output_never_contains_the_key() {
    let config = config();
    let printed = format!("{config:?}");
    assert!(
        !printed.contains(KEY),
        "the plaintext key must not appear in {printed}"
    );
    assert!(!printed.contains("secret_do_not_print_me"));

    let client = CursorClient::new(config).expect("a shape-valid key builds a client");
    let printed = format!("{client:?}");
    assert!(
        !printed.contains(KEY),
        "the plaintext key must not appear in {printed}"
    );
    assert!(!printed.contains("secret_do_not_print_me"));
}

/// The key still has to reach the Basic-auth header intact.
#[test]
fn the_key_is_still_readable_where_it_is_used() {
    assert_eq!(ApiKey::new(KEY).expose(), KEY);
}

/// Keys pasted into JSON `env` blocks arrive quoted or newline-terminated;
/// the API rejects those as *invalid* keys rather than malformed headers.
#[test]
fn surrounding_quotes_and_whitespace_are_trimmed() {
    assert_eq!(ApiKey::new("  \"crsr_abc\"\n").expose(), "crsr_abc");
    assert_eq!(ApiKey::new("'crsr_abc'").expose(), "crsr_abc");
}

/// A placeholder must fail at startup with something recognizable, which is
/// why the error deliberately reports a length and a short prefix.
#[test]
fn a_placeholder_key_is_rejected_with_a_diagnostic() {
    let error = CursorClient::new(CursorConfig {
        api_key: ApiKey::new("..."),
        ..config()
    })
    .expect_err("a placeholder is not a key");
    assert!(matches!(
        error,
        CursorClientError::MalformedKey { length: 3, .. }
    ));
}
