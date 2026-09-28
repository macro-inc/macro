use super::*;

/// The deserialization error is what a model reads back as the tool result, so
/// it has to say which argument was wrong rather than only that something was.
#[test]
fn deserialization_error_carries_the_serde_detail() {
    let error = serde_json::from_value::<u8>(serde_json::json!("email")).unwrap_err();
    let detail = error.to_string();

    let message = ToolSetError::Deserialization(error).to_string();

    assert!(
        message.starts_with("error deserializing tool call"),
        "message should keep its prefix, got {message}"
    );
    assert!(
        message.ends_with(&detail),
        "message should end with the serde detail {detail:?}, got {message}"
    );
}
