use super::MutationSettledEvent;
use serde_json::json;

#[test]
fn permanent_settlement_preserves_optional_domain_code_on_the_native_wire() {
    for code in [None, Some("DRAFT_ALREADY_SENT"), Some("INTERNAL")] {
        let event = MutationSettledEvent {
            transaction_id: "1".into(),
            mutation_uuid: Some("draft-handle".into()),
            status: "permanently-failed",
            error: Some("server rejected draft".into()),
            error_code: code.map(str::to_owned),
            replacement_transaction_id: None,
        };
        let mut expected = json!({
            "transactionId": "1", "mutationUuid": "draft-handle",
            "status": "permanently-failed", "error": "server rejected draft",
        });
        if let Some(code) = code {
            expected["errorCode"] = json!(code);
        }
        assert_eq!(serde_json::to_value(event).unwrap(), expected);
    }
}
