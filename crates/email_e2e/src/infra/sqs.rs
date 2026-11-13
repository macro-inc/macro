//! The scenario's own SQS queues, with production's attributes, on the
//! SQS-compatible server `EMAIL_E2E_SQS_URL` names.

use std::collections::HashMap;

use aws_sdk_sqs::types::QueueAttributeName;
use rootcause::prelude::*;

/// A queue `email_service` or `pubsub_workers` uses.
struct QueueSpec {
    /// The environment variable that points the typed queue name elsewhere.
    override_env: &'static str,
    /// What the scenario's queue name ends with.
    name: &'static str,
    visibility_timeout_seconds: u32,
    /// Receives before a message moves to the dead-letter queue.
    max_receive_count: u32,
}

/// The queues and attributes of `infra/stacks/email-service`, plus the two
/// queues other stacks own. A queue without a count there gets the `Queue`
/// resource's default of 5, and without a timeout its default of 30 seconds.
const QUEUES: &[QueueSpec] = &[
    QueueSpec {
        override_env: "OVERRIDE_GMAIL_INBOX_SYNC_QUEUE",
        name: "gmail-inbox-sync",
        visibility_timeout_seconds: 60,
        max_receive_count: 3,
    },
    QueueSpec {
        override_env: "OVERRIDE_GMAIL_INBOX_SYNC_RETRY_QUEUE",
        name: "gmail-inbox-sync-retry",
        visibility_timeout_seconds: 60,
        max_receive_count: 100,
    },
    QueueSpec {
        override_env: "OVERRIDE_GMAIL_OPS_QUEUE",
        name: "gmail-ops",
        visibility_timeout_seconds: 60,
        max_receive_count: 3,
    },
    QueueSpec {
        override_env: "OVERRIDE_GMAIL_OPS_RETRY_QUEUE",
        name: "gmail-ops-retry",
        visibility_timeout_seconds: 60,
        max_receive_count: 100,
    },
    QueueSpec {
        override_env: "OVERRIDE_LINK_MANAGER_QUEUE",
        name: "link-manager",
        visibility_timeout_seconds: 300,
        max_receive_count: 5,
    },
    QueueSpec {
        override_env: "OVERRIDE_EMAIL_SCHEDULED_QUEUE",
        name: "scheduled",
        visibility_timeout_seconds: 30,
        max_receive_count: 5,
    },
    QueueSpec {
        override_env: "OVERRIDE_EMAIL_BACKFILL_QUEUE",
        name: "backfill",
        visibility_timeout_seconds: 60,
        max_receive_count: 20,
    },
    QueueSpec {
        override_env: "OVERRIDE_EMAIL_CRM_CLEANUP_QUEUE",
        name: "crm-cleanup",
        visibility_timeout_seconds: 60,
        max_receive_count: 5,
    },
    QueueSpec {
        override_env: "OVERRIDE_SFS_UPLOADER_QUEUE",
        name: "sfs-uploader",
        visibility_timeout_seconds: 60,
        max_receive_count: 5,
    },
    QueueSpec {
        override_env: "OVERRIDE_SFS_DELETE_QUEUE",
        name: "sfs-delete",
        visibility_timeout_seconds: 30,
        max_receive_count: 5,
    },
    QueueSpec {
        override_env: "OVERRIDE_CONTACTS_QUEUE",
        name: "contacts",
        visibility_timeout_seconds: 30,
        max_receive_count: 5,
    },
    QueueSpec {
        override_env: "OVERRIDE_NOTIFICATION_INGRESS_QUEUE",
        name: "notification-ingress",
        visibility_timeout_seconds: 30,
        max_receive_count: 5,
    },
];

/// One of the scenario's queues.
#[derive(Clone, Debug)]
pub(crate) struct Queue {
    pub(crate) override_env: &'static str,
    pub(crate) name: &'static str,
    pub(crate) url: String,
    pub(crate) dead_letter_url: String,
}

/// The scenario's queues and the client that made them.
pub(crate) struct Queues {
    client: aws_sdk_sqs::Client,
    queues: Vec<Queue>,
}

impl Queues {
    /// Creates every queue, each with its dead-letter queue, under names
    /// that start with `prefix`.
    pub(crate) async fn create(server_url: &str, prefix: &str) -> Result<Self, Report> {
        let config = macro_aws_config::local_aws_config(server_url).await;
        let client = aws_sdk_sqs::Client::new(&config);

        let mut queues = Vec::with_capacity(QUEUES.len());
        for spec in QUEUES {
            queues.push(create_queue(&client, prefix, spec).await?);
        }

        Ok(Self { client, queues })
    }

    /// Every queue of the scenario.
    pub(crate) fn all(&self) -> &[Queue] {
        &self.queues
    }

    /// The queue whose name ends with `name`, such as `gmail-ops`.
    pub(crate) fn named(&self, name: &str) -> Result<&Queue, Report> {
        self.queues
            .iter()
            .find(|queue| queue.name == name)
            .ok_or_else(|| report!("the email services have no `{name}` queue"))
    }

    /// Puts a message on a queue, as one of the scheduled handlers would.
    pub(crate) async fn send(&self, name: &str, body: String) -> Result<(), Report> {
        let queue = self.named(name)?;
        self.client
            .send_message()
            .queue_url(&queue.url)
            .message_body(body)
            .send()
            .await
            .context("could not send the queue message")?;
        Ok(())
    }

    /// Receives and deletes every message waiting on a queue, parsed as JSON.
    pub(crate) async fn take(&self, name: &str) -> Result<Vec<serde_json::Value>, Report> {
        let queue = self.named(name)?;
        let mut taken = Vec::new();
        loop {
            let received = self
                .client
                .receive_message()
                .queue_url(&queue.url)
                .max_number_of_messages(10)
                .send()
                .await
                .context("could not receive from the queue")?;
            let messages = received.messages();
            if messages.is_empty() {
                return Ok(taken);
            }
            for message in messages {
                let body = message.body().unwrap_or_default();
                taken.push(
                    serde_json::from_str(body)
                        .unwrap_or_else(|_| serde_json::Value::String(body.to_owned())),
                );
                if let Some(receipt) = message.receipt_handle() {
                    self.client
                        .delete_message()
                        .queue_url(&queue.url)
                        .receipt_handle(receipt)
                        .send()
                        .await
                        .context("could not delete the received queue message")?;
                }
            }
        }
    }

    /// How many messages wait, are in flight or are delayed on a queue.
    pub(crate) async fn depth(&self, url: &str) -> Result<u64, Report> {
        let attributes = self
            .client
            .get_queue_attributes()
            .queue_url(url)
            .attribute_names(QueueAttributeName::ApproximateNumberOfMessages)
            .attribute_names(QueueAttributeName::ApproximateNumberOfMessagesNotVisible)
            .attribute_names(QueueAttributeName::ApproximateNumberOfMessagesDelayed)
            .send()
            .await
            .context("could not read the queue's attributes")?;

        let depth = attributes
            .attributes()
            .into_iter()
            .flat_map(HashMap::values)
            .filter_map(|count| count.parse::<u64>().ok())
            .sum();
        Ok(depth)
    }

    /// Deletes the scenario's queues.
    pub(crate) async fn delete(self) {
        for queue in &self.queues {
            for url in [&queue.url, &queue.dead_letter_url] {
                if let Err(error) = self.client.delete_queue().queue_url(url).send().await {
                    tracing::warn!(error = ?error, url, "could not delete a scenario queue");
                }
            }
        }
    }
}

async fn create_queue(
    client: &aws_sdk_sqs::Client,
    prefix: &str,
    spec: &QueueSpec,
) -> Result<Queue, Report> {
    let dead_letter_name = format!("{prefix}-{}-dlq", spec.name);
    let dead_letter_url = client
        .create_queue()
        .queue_name(&dead_letter_name)
        .send()
        .await
        .context("could not create a dead-letter queue at EMAIL_E2E_SQS_URL")?
        .queue_url
        .ok_or_else(|| report!("the SQS server answered no URL for {dead_letter_name}"))?;
    let dead_letter_arn = client
        .get_queue_attributes()
        .queue_url(&dead_letter_url)
        .attribute_names(QueueAttributeName::QueueArn)
        .send()
        .await?
        .attributes()
        .and_then(|attributes| attributes.get(&QueueAttributeName::QueueArn))
        .cloned()
        .ok_or_else(|| report!("the SQS server answered no ARN for {dead_letter_name}"))?;

    let redrive_policy = serde_json::json!({
        "deadLetterTargetArn": dead_letter_arn,
        "maxReceiveCount": spec.max_receive_count,
    })
    .to_string();
    let name = format!("{prefix}-{}", spec.name);
    let url = client
        .create_queue()
        .queue_name(&name)
        .attributes(
            QueueAttributeName::VisibilityTimeout,
            spec.visibility_timeout_seconds.to_string(),
        )
        .attributes(QueueAttributeName::RedrivePolicy, redrive_policy)
        .send()
        .await
        .context("could not create a queue at EMAIL_E2E_SQS_URL")?
        .queue_url
        .ok_or_else(|| report!("the SQS server answered no URL for {name}"))?;

    Ok(Queue {
        override_env: spec.override_env,
        name: spec.name,
        url,
        dead_letter_url,
    })
}
