use super::*;
use async_graphql::{EmptyMutation, EmptySubscription, Schema};

#[derive(SimpleObject)]
struct Query {
    operation: GraphqlMessageOperation,
}

#[tokio::test]
async fn failure_detail_is_optional_and_does_not_change_existing_client_queries() {
    for (reason, wire) in [
        (None, serde_json::Value::Null),
        (
            Some(SendRejectionReason::ConnectionUnavailable),
            serde_json::json!("CONNECTION_UNAVAILABLE"),
        ),
        (
            Some(SendRejectionReason::ProviderRejected),
            serde_json::json!("PROVIDER_REJECTED"),
        ),
    ] {
        let schema = Schema::build(
            Query {
                operation: MessageOperationStatus {
                    state: MessageOperationState::Failed,
                    revision: 7,
                    remote_version: None,
                    issue: Some(MessageOperationIssue::SendRejected),
                    send_rejection_reason: reason,
                }
                .into(),
            },
            EmptyMutation,
            EmptySubscription,
        )
        .finish();
        let legacy = schema.execute("{ operation { state issue } }").await;
        assert!(legacy.errors.is_empty());
        assert_eq!(
            legacy.data.into_json().unwrap(),
            serde_json::json!({"operation":{"state":"FAILED","issue":"SEND_REJECTED"}})
        );
        let detailed = schema
            .execute("{ operation { state issue sendRejectionReason } }")
            .await;
        assert!(detailed.errors.is_empty());
        assert_eq!(
            detailed.data.into_json().unwrap(),
            serde_json::json!({"operation":{"state":"FAILED","issue":"SEND_REJECTED","sendRejectionReason":wire}})
        );
    }
}
