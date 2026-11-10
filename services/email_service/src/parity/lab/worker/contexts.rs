use super::{super::Lab, Queue};
use crate::pubsub;
use crate::pubsub::context::PubSubContext;
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use std::sync::Arc;

#[derive(Clone)]
pub(in crate::parity::lab) struct WorkerContexts {
    ops: GmailOpsContext,
    ops_retry: GmailOpsContext,
    sync: PubSubContext,
    sync_retry: PubSubContext,
    backfill: PubSubContext,
    links: pubsub::link_manager::context::LinkManagerContext,
    crm: pubsub::crm_cleanup::worker::CrmCleanupContext,
    upload: pubsub::sfs_uploader::context::SFSUploaderContext,
    #[cfg(feature = "sfs_delete")]
    delete: pubsub::sfs_deleter::context::SFSDeleteContext,
    scheduled: pubsub::scheduled::context::ScheduledContext,
}

impl WorkerContexts {
    pub async fn new(lab: &Lab) -> Self {
        let api = &lab.api;
        let sdk = pubsub::label_write_sim::fake_sqs::client(&lab.sqs.url, false);
        let worker = |queue: Queue| {
            sqs_worker::SQSWorker::new(sdk.clone(), lab.sqs.queue_url(queue.name()), 1, 0)
        };
        let queue = api
            .sqs_client
            .as_ref()
            .clone()
            .email_crm_cleanup_queue(&lab.sqs.queue_url(Queue::CrmCleanup.name()))
            .sfs_delete_queue(&lab.sqs.queue_url("sfs-delete"));
        let contacts = Arc::new(contacts::domain::service::SqsContactsIngress {
            queue: contacts::outbound::ingress::SqsContactsQueue::new(
                sdk.clone(),
                lab.sqs.queue_url("contacts"),
            ),
        });
        let notifications = Arc::new(notification::domain::service::SqsNotificationIngress {
            queue: notification::outbound::queue::SqsQueue::new(
                sdk.clone(),
                lab.sqs.queue_url("notifications"),
            ),
        });
        let gateway = connection_gateway_client::client::ConnectionGatewayClient::new(
            "parity".into(),
            lab.stub.url.clone(),
        );
        let crm = pubsub::label_write_sim::wiring::crm_service(api.db.clone());
        let sync = |which: Queue, retry| {
            pubsub::inbox_sync::worker::context(
                api.db.clone(),
                &worker(which),
                queue.clone(),
                contacts.clone(),
                api.email_api.clone(),
                api.redis_client.as_ref().clone(),
                notifications.clone(),
                api.sfs_client.as_ref().clone(),
                gateway.clone(),
                api.dss_client.as_ref().clone(),
                api.system_properties_service.clone(),
                crm.clone(),
                api.macro_event_broker.as_ref().clone(),
                api.config.notifications_enabled,
                retry,
            )
        };
        let backfill_api = pubsub::label_write_sim::wiring::gmail_api_with_budget(
            api.db.clone(),
            &api.redis_client.inner,
            &lab.gmail.url,
            &lab.stub.url,
            queue.clone(),
            crate::outbound::email_api::RateBudget::Backfill,
        )
        .await;
        Self {
            ops: pubsub::gmail_ops::worker::context(
                api.db.clone(),
                &worker(Queue::GmailOps),
                queue.clone(),
                api.email_api.clone(),
                false,
            ),
            ops_retry: pubsub::gmail_ops::worker::context(
                api.db.clone(),
                &worker(Queue::GmailOpsRetry),
                queue.clone(),
                api.email_api.clone(),
                true,
            ),
            sync: sync(Queue::InboxSync, false),
            sync_retry: sync(Queue::InboxSyncRetry, true),
            backfill: pubsub::backfill::worker::context(
                api.db.clone(),
                &worker(Queue::Backfill),
                queue.clone(),
                contacts.clone(),
                backfill_api,
                api.redis_client.as_ref().clone(),
                notifications.clone(),
                api.sfs_client.as_ref().clone(),
                gateway.clone(),
                api.dss_client.as_ref().clone(),
                api.system_properties_service.clone(),
                crm.clone(),
                api.macro_event_broker.as_ref().clone(),
                api.config.notifications_enabled,
            ),
            links: pubsub::link_manager::worker::context(
                worker(Queue::LinkManager),
                api.db.clone(),
                api.email_api.clone(),
                api.auth_service_client.as_ref().clone(),
                api.redis_client.as_ref().clone(),
                queue.clone(),
                crm.clone(),
                gateway.clone(),
                notifications,
                api.macro_event_broker.as_ref().clone(),
                contacts,
                tokio_util::sync::CancellationToken::new(),
            )
            .await
            .expect("production link manager composition"),
            crm: pubsub::crm_cleanup::worker::context(
                api.db.clone(),
                &worker(Queue::CrmCleanup),
                queue,
                crm,
            ),
            upload: pubsub::sfs_uploader::worker::context(
                &worker(Queue::SfsUploader),
                api.db.clone(),
                api.sfs_client.as_ref().clone(),
                gateway,
            ),
            #[cfg(feature = "sfs_delete")]
            delete: pubsub::sfs_deleter::worker::context(
                &worker(Queue::SfsDeleter),
                api.db.clone(),
                api.sfs_client.as_ref().clone(),
            ),
            scheduled: pubsub::scheduled::worker::context(
                worker(Queue::Scheduled),
                api.db.clone(),
                api.email_api.clone(),
                api.draft_transfers.bytes.clone(),
                api.s3_client.as_ref().clone(),
                api.config.attachment_bucket.to_string(),
                api.macro_event_broker.as_ref().clone(),
                api.read_receipts.clone(),
            ),
        }
    }

    pub fn receiver(&self, queue: Queue) -> &sqs_worker::SQSWorker {
        match queue {
            Queue::GmailOps => &self.ops.sqs_worker,
            Queue::GmailOpsRetry => &self.ops_retry.sqs_worker,
            Queue::InboxSync => &self.sync.sqs_worker,
            Queue::InboxSyncRetry => &self.sync_retry.sqs_worker,
            Queue::Backfill => &self.backfill.sqs_worker,
            Queue::LinkManager => &self.links.sqs_worker,
            Queue::CrmCleanup => &self.crm.sqs_worker,
            Queue::SfsUploader => &self.upload.sqs_worker,
            #[cfg(feature = "sfs_delete")]
            Queue::SfsDeleter => &self.delete.sqs_worker,
            Queue::Scheduled => &self.scheduled.sqs_worker,
        }
    }

    pub async fn process(
        &self,
        queue: Queue,
        message: &aws_sdk_sqs::types::Message,
    ) -> anyhow::Result<()> {
        match queue {
            Queue::GmailOps => {
                Box::pin(pubsub::gmail_ops::process::process_message(
                    self.ops.clone(),
                    message,
                ))
                .await
            }
            Queue::GmailOpsRetry => {
                Box::pin(pubsub::gmail_ops::process::process_message(
                    self.ops_retry.clone(),
                    message,
                ))
                .await
            }
            Queue::InboxSync => {
                Box::pin(pubsub::inbox_sync::process::process_message(
                    self.sync.clone(),
                    message,
                ))
                .await
            }
            Queue::InboxSyncRetry => {
                Box::pin(pubsub::inbox_sync::process::process_message(
                    self.sync_retry.clone(),
                    message,
                ))
                .await
            }
            Queue::Backfill => {
                Box::pin(pubsub::backfill::process::process_message(
                    self.backfill.clone(),
                    message,
                ))
                .await
            }
            Queue::LinkManager => {
                Box::pin(pubsub::link_manager::process::process_message(
                    self.links.clone(),
                    message,
                ))
                .await
            }
            Queue::CrmCleanup => {
                Box::pin(pubsub::crm_cleanup::process::process_message(
                    self.crm.clone(),
                    message,
                ))
                .await
            }
            Queue::SfsUploader => {
                Box::pin(pubsub::sfs_uploader::process::process_message(
                    self.upload.clone(),
                    message,
                ))
                .await
            }
            #[cfg(feature = "sfs_delete")]
            Queue::SfsDeleter => {
                Box::pin(pubsub::sfs_deleter::process::process_message(
                    self.delete.clone(),
                    message,
                ))
                .await
            }
            Queue::Scheduled => {
                Box::pin(pubsub::scheduled::process::process_message(
                    self.scheduled.clone(),
                    message,
                ))
                .await
            }
        }
    }
}
