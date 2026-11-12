use chrono::Timelike;
use email_types::email::service::pubsub::{DeletionReason, LinkManagerMessage};

use super::{
    models::MaintenanceConfig,
    ports::{LinkManagerQueue, LinkRepository, RefreshService},
};

pub(crate) struct LinkMaintenance<R, Q> {
    repository: R,
    queue: Q,
    config: MaintenanceConfig,
}

impl<R, Q> LinkMaintenance<R, Q> {
    pub(crate) fn new(repository: R, queue: Q, config: MaintenanceConfig) -> Self {
        Self {
            repository,
            queue,
            config,
        }
    }
}

impl<R: LinkRepository, Q: LinkManagerQueue> RefreshService for LinkMaintenance<R, Q> {
    async fn refresh(&self) -> anyhow::Result<()> {
        tokio::try_join!(
            self.send_refresh_messages(),
            self.send_health_check_messages()
        )?;

        // only send delete messages once daily, during the night
        if self.config.is_production && chrono::Utc::now().hour() == 5 {
            self.send_delete_messages().await?;
        }

        Ok(())
    }
}

impl<R: LinkRepository, Q: LinkManagerQueue> LinkMaintenance<R, Q> {
    /// Send health-check notifications for active links, bucketed by id hash.
    async fn send_health_check_messages(&self) -> anyhow::Result<()> {
        let interval_hours = self.config.health_poll_interval_hours as i32;
        if interval_hours <= 0 {
            return Ok(());
        }

        let now = chrono::Utc::now();
        let current_hour = now.hour();
        // Bucket on hours since the epoch rather than hour-of-day, so every bucket stays
        // reachable even when the interval exceeds 24 hours.
        let bucket = (now.timestamp().div_euclid(3600) % i64::from(interval_hours)) as i32;

        let link_ids = self
            .repository
            .fetch_health_check_link_ids(interval_hours, bucket)
            .await
            .unwrap_or_else(|e| {
                tracing::error!(error = ?e, "Error fetching links for health check");
                Vec::new()
            });

        if !link_ids.is_empty() {
            tracing::info!(
                "Hour {}. Sending health-check notifications for {} links (every {}h)",
                current_hour,
                link_ids.len(),
                interval_hours
            );

            for link_id in link_ids {
                let notif = LinkManagerMessage::HealthCheck { link_id };
                self.queue
                    .enqueue_link_manager_notification(notif)
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, link_id=%link_id, "Error enqueueing health-check notification for link");
                    })
                    .ok();
            }
        }
        Ok(())
    }

    /// Send refresh notifications for active links.
    async fn send_refresh_messages(&self) -> anyhow::Result<()> {
        let current_hour = chrono::Utc::now().hour() as i32;

        let link_ids = self
            .repository
            .fetch_refresh_link_ids(current_hour)
            .await
            .unwrap_or_else(|e| {
                tracing::error!(error = ?e, "Error fetching links for refresh");
                Vec::new()
            });

        if !link_ids.is_empty() {
            tracing::info!(
                "Hour {}. Sending refresh notifications for {} links",
                current_hour,
                link_ids.len()
            );

            for link_id in link_ids {
                let notif = LinkManagerMessage::Refresh { link_id };
                self.queue
                    .enqueue_link_manager_notification(notif)
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, link_id=%link_id, "Error enqueueing refresh notification for link");
                    })
                    .ok();
            }
        }
        Ok(())
    }

    /// Queue deletion of unused and inactive links.
    async fn send_delete_messages(&self) -> anyhow::Result<()> {
        let unused_links = self
            .repository
            .fetch_unused_link_ids(self.config.delete_unused_after_days as i32)
            .await
            .unwrap_or_else(|e| {
                tracing::error!(error=?e, "Error fetching unused links for deletion");
                Vec::new()
            });

        let inactive_links = self
            .repository
            .fetch_inactive_link_ids(self.config.delete_inactive_after_days as i32)
            .await
            .unwrap_or_else(|e| {
                tracing::error!(error=?e, "Error fetching inactive links for deletion");
                Vec::new()
            });

        tracing::info!(
            "Sending delete notifications for {} unused and {} inactive links",
            unused_links.len(),
            inactive_links.len()
        );

        for link_id in unused_links {
            let notif = LinkManagerMessage::DeleteLink {
                link_id,
                deletion_reason: DeletionReason::Unused,
            };
            self.queue
                .enqueue_link_manager_notification(notif)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, link_id=%link_id, "Error enqueueing delete notification for unused link");
                })
                .ok();
        }

        for link_id in inactive_links {
            let notif = LinkManagerMessage::DeleteLink {
                link_id,
                deletion_reason: DeletionReason::Inactive,
            };
            self.queue
                .enqueue_link_manager_notification(notif)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, link_id=%link_id, "Error enqueueing delete notification for inactive link");
                })
                .ok();
        }

        Ok(())
    }
}

#[cfg(test)]
mod test;
