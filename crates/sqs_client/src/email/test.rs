use super::*;
use models_email::gmail::gmail_ops::{
    BlockSenderPayload, GmailOpsOperation, GmailOpsPubsubMessage, UnblockSenderPayload,
};

/// The gmail_ops message format of the newest released workers, copied from
/// `models_email::gmail::gmail_ops` on `main` before `ModifyMessageLabelsBatch`,
/// limited to the operations producers enqueue. During a rolling deploy these
/// workers consume whatever new producers send.
mod released_worker {
    use serde::Deserialize;
    use uuid::Uuid;

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct GmailOpsPubsubMessage {
        pub link_id: Uuid,
        pub operation: GmailOpsOperation,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "snake_case")]
    pub enum GmailOpsOperation {
        ModifyMessageLabels(ModifyMessageLabelsPayload),
        BlockSender(BlockSenderPayload),
        UnblockSender(UnblockSenderPayload),
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct ModifyMessageLabelsPayload {
        pub db_message_id: Uuid,
        pub provider_message_id: String,
        pub labels_to_add: Vec<String>,
        pub labels_to_remove: Vec<String>,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct BlockSenderPayload {
        pub email_address: String,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct UnblockSenderPayload {
        pub email_address: String,
    }
}

fn client() -> SQS {
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
        .region(aws_sdk_sqs::config::Region::new("us-east-1"))
        .build();
    SQS::new(aws_sdk_sqs::Client::from_conf(config))
}

fn decode_with_released_worker(
    message: &GmailOpsPubsubMessage,
) -> serde_json::Result<released_worker::GmailOpsPubsubMessage> {
    serde_json::from_str(&serde_json::to_string(message).unwrap())
}

const WRITE: Uuid = Uuid::from_u128(0xb1);

fn label_write(count: u128) -> Vec<(Uuid, String)> {
    (0..count)
        .map(|index| (Uuid::from_u128(index), format!("message-{index}")))
        .collect()
}

#[test]
fn released_workers_decode_everything_a_default_producer_sends() {
    let link_id = Uuid::from_u128(0xa1);
    let mut messages = client().gmail_label_write_messages(
        link_id,
        label_write(1001),
        vec![],
        vec!["INBOX".to_string()],
        WRITE,
    );
    messages.extend([
        GmailOpsPubsubMessage {
            link_id,
            operation: GmailOpsOperation::BlockSender(BlockSenderPayload {
                email_address: "sender@example.com".to_string(),
            }),
        },
        GmailOpsPubsubMessage {
            link_id,
            operation: GmailOpsOperation::UnblockSender(UnblockSenderPayload {
                email_address: "sender@example.com".to_string(),
            }),
        },
    ]);

    let decoded: Vec<_> = messages
        .iter()
        .map(|message| decode_with_released_worker(message).unwrap())
        .collect();

    let mut expected: Vec<_> = label_write(1001)
        .into_iter()
        .map(
            |(db_message_id, provider_message_id)| released_worker::GmailOpsPubsubMessage {
                link_id,
                operation: released_worker::GmailOpsOperation::ModifyMessageLabels(
                    released_worker::ModifyMessageLabelsPayload {
                        db_message_id,
                        provider_message_id,
                        labels_to_add: vec![],
                        labels_to_remove: vec!["INBOX".to_string()],
                    },
                ),
            },
        )
        .collect();
    expected.extend([
        released_worker::GmailOpsPubsubMessage {
            link_id,
            operation: released_worker::GmailOpsOperation::BlockSender(
                released_worker::BlockSenderPayload {
                    email_address: "sender@example.com".to_string(),
                },
            ),
        },
        released_worker::GmailOpsPubsubMessage {
            link_id,
            operation: released_worker::GmailOpsOperation::UnblockSender(
                released_worker::UnblockSenderPayload {
                    email_address: "sender@example.com".to_string(),
                },
            ),
        },
    ]);
    assert_eq!(decoded, expected);
}

#[test]
fn label_write_batches_are_sent_only_when_enabled() {
    let messages = client()
        .gmail_label_write_batches(true)
        .gmail_label_write_messages(
            Uuid::from_u128(0xa1),
            label_write(1001),
            vec!["TRASH".to_string()],
            vec![],
            WRITE,
        );

    assert_eq!(
        messages
            .iter()
            .map(|message| match &message.operation {
                GmailOpsOperation::ModifyMessageLabelsBatch(payload) => payload.messages.len(),
                other => panic!("expected a batch, got {other}"),
            })
            .collect::<Vec<_>>(),
        vec![1000, 1]
    );
    // Why the switch exists: a released worker cannot decode a batch and
    // deletes it.
    assert!(
        messages
            .iter()
            .all(|message| decode_with_released_worker(message).is_err())
    );
}

#[test]
fn every_label_write_operation_carries_the_write_id_with_or_without_batches() {
    for batches in [false, true] {
        let messages = client()
            .gmail_label_write_batches(batches)
            .gmail_label_write_messages(
                Uuid::from_u128(0xa1),
                label_write(1001),
                vec![],
                vec!["INBOX".to_string()],
                WRITE,
            );

        let write_ids: Vec<_> = messages
            .iter()
            .map(|message| match &message.operation {
                GmailOpsOperation::ModifyMessageLabels(payload) => payload.pending_write_id,
                GmailOpsOperation::ModifyMessageLabelsBatch(payload) => payload.pending_write_id,
                other => panic!("expected a label write, got {other}"),
            })
            .collect();
        assert_eq!(write_ids.len(), if batches { 2 } else { 1001 });
        assert!(write_ids.iter().all(|write_id| *write_id == Some(WRITE)));
    }
}

/// An SQS endpoint accepting every `SendMessage`, and a client of it whose
/// link-manager lanes are its `interactive` and `maintenance` queues.
async fn link_manager_queues() -> (wiremock::MockServer, SQS) {
    use aws_sdk_sqs::config::{BehaviorVersion, Credentials, Region, retry::RetryConfig};
    use wiremock::matchers::{header, method};

    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(method("POST"))
        .and(header("x-amz-target", "AmazonSQS.SendMessage"))
        .respond_with(
            wiremock::ResponseTemplate::new(200)
                .insert_header("content-type", "application/x-amz-json-1.0")
                .set_body_string(r#"{"MessageId":"sent","MD5OfMessageBody":"unused"}"#),
        )
        .mount(&server)
        .await;
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-1"))
        .credentials_provider(Credentials::new("test", "test", None, None, "test"))
        .endpoint_url(server.uri())
        .retry_config(RetryConfig::disabled())
        .build();
    let sqs = SQS::new(aws_sdk_sqs::Client::from_conf(config))
        .email_link_manager_queue(&format!("{}/interactive", server.uri()))
        .email_link_maintenance_queue(&format!("{}/maintenance", server.uri()));
    (server, sqs)
}

/// The queue path each `SendMessage` the server received went to, in order.
async fn queues_sent_to(server: &wiremock::MockServer) -> Vec<String> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|request| {
            let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
            let url = body["QueueUrl"].as_str().unwrap();
            url.rsplit('/').next().unwrap().to_owned()
        })
        .collect()
}

#[tokio::test]
async fn the_sweeps_work_and_its_purges_go_to_maintenance_and_a_persons_removal_does_not() {
    use models_email::email::service::pubsub::DeletionReason;

    let (server, sqs) = link_manager_queues().await;
    let link_id = Uuid::from_u128(0xa1);
    let removal = |deletion_reason| LinkManagerMessage::DeleteLink {
        link_id,
        deletion_reason,
    };

    sqs.enqueue_link_manager_notification(
        LinkManagerMessage::HealthCheck { link_id },
        LinkManagerSender::Sweep,
    )
    .await
    .unwrap();
    // The lifecycle publisher's purge of the sweep's removal.
    sqs.enqueue_link_manager_notification(
        removal(DeletionReason::Unused),
        LinkManagerSender::Event,
    )
    .await
    .unwrap();
    sqs.enqueue_link_manager_notification(
        removal(DeletionReason::ManuallyDisabled),
        LinkManagerSender::Event,
    )
    .await
    .unwrap();

    assert_eq!(
        queues_sent_to(&server).await,
        ["maintenance", "maintenance", "interactive"]
    );
}

#[tokio::test]
async fn a_client_without_the_maintenance_queue_refuses_maintenance_work() {
    let (server, _) = link_manager_queues().await;
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
        .region(aws_sdk_sqs::config::Region::new("us-east-1"))
        .endpoint_url(server.uri())
        .build();
    let sqs = SQS::new(aws_sdk_sqs::Client::from_conf(config))
        .email_link_manager_queue(&format!("{}/interactive", server.uri()));

    let error = sqs
        .enqueue_link_manager_notification(
            LinkManagerMessage::Refresh {
                link_id: Uuid::from_u128(0xa1),
            },
            LinkManagerSender::Sweep,
        )
        .await
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "the maintenance link manager queue is not configured"
    );
    assert!(queues_sent_to(&server).await.is_empty());
}
