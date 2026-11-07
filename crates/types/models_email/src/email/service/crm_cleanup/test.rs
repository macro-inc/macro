use super::*;

/// The EventBridge rule sends this exact static payload straight to the
/// queue (see infra/stacks/email-service/index.ts). If the serde shape of
/// the wrapper or enum changes, the nightly cron silently stops parsing —
/// this test pins the wire format.
#[test]
fn start_job_static_payload_deserializes() {
    let msg: CrmCleanupPubsubMessage = serde_json::from_str(r#"{"operation":"start_job"}"#)
        .expect("EventBridge static payload must deserialize");
    assert_eq!(msg.operation, CrmCleanupOperation::StartJob);
}

#[test]
fn operations_round_trip() {
    let list = CrmCleanupPubsubMessage {
        operation: CrmCleanupOperation::ListCandidates {
            job_id: Uuid::new_v4(),
            last_id: 42,
        },
    };
    let process = CrmCleanupPubsubMessage {
        operation: CrmCleanupOperation::ProcessCandidate {
            link_id: Uuid::new_v4(),
            contact_email: "contact@ext.test".to_string(),
        },
    };

    for msg in [list, process] {
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: CrmCleanupPubsubMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.operation, msg.operation);
    }
}
