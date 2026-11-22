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
                    send_refusal: None,
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

#[tokio::test]
async fn smtp_refusal_detail_uses_closed_types_without_transporting_recipient_addresses() {
    use email::domain::models::mailbox_operation::{
        SubmissionRefusal, SubmissionRefusalClass, SubmissionRefusalPhase,
    };
    let schema = Schema::build(
        Query {
            operation: MessageOperationStatus {
                state: MessageOperationState::Failed,
                revision: 7,
                remote_version: None,
                issue: Some(MessageOperationIssue::SendRejected),
                send_rejection_reason: Some(SendRejectionReason::ProviderRejected),
                send_refusal: Some(SubmissionRefusal {
                    phase: SubmissionRefusalPhase::Recipient,
                    recipient_index: Some(1),
                    reply_class: Some(SubmissionRefusalClass::Permanent),
                }),
            }
            .into(),
        },
        EmptyMutation,
        EmptySubscription,
    )
    .finish();
    let result = schema
        .execute("{ operation { sendRefusal { phase recipientIndex replyClass } } }")
        .await;
    assert!(result.errors.is_empty());
    assert_eq!(
        result.data.into_json().unwrap(),
        serde_json::json!({"operation":{"sendRefusal":{"phase":"RECIPIENT","recipientIndex":1,"replyClass":"PERMANENT"}}})
    );
}
