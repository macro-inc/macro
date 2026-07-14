//! VoIP push notification service.
//!
//! Sends PushKit VoIP pushes directly (no queue, no DB persistence) so that
//! CallKit can display the native incoming-call UI on iOS.

#[cfg(test)]
mod test;

use futures::future;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::HashSet;

use crate::domain::models::VoipPushTarget;
use crate::domain::models::apple::VoipPushPayload;
use crate::domain::models::mobile::DeviceEndpoint;
use crate::domain::ports::{NotificationRepository, VoipPushSender};
use crate::outbound::mobile::MobilePushAdapter;
use crate::outbound::mobile::MobilePushOps;

const VOIP_PUSH_DELIVERY_CONCURRENCY: usize = 32;

/// Direct APNS_VOIP sender for CallKit pushes.
pub struct VoipPushServiceImpl<R, P> {
    repository: R,
    mobile: MobilePushAdapter<P>,
}

impl<R, P> VoipPushServiceImpl<R, P> {
    /// Builds a sender that resolves endpoints through the repository and delivers through SNS.
    pub fn new(repository: R, mobile: MobilePushAdapter<P>) -> Self {
        Self { repository, mobile }
    }
}

impl<R, P> VoipPushSender for VoipPushServiceImpl<R, P>
where
    R: NotificationRepository,
    P: MobilePushOps + Send + Sync + 'static,
{
    async fn get_voip_push_targets(
        &self,
        recipient_ids: &[MacroUserIdStr<'_>],
    ) -> Result<Vec<VoipPushTarget>, Report> {
        let device_map = self.repository.get_device_endpoints(recipient_ids).await?;

        Ok(device_map
            .into_iter()
            .filter_map(|(recipient_id, endpoints)| {
                let endpoint_arns: Vec<String> = endpoints
                    .into_iter()
                    .filter_map(|endpoint| match endpoint {
                        DeviceEndpoint::IosVoip(arn) => Some(arn),
                        _ => None,
                    })
                    .collect();

                (!endpoint_arns.is_empty()).then_some(VoipPushTarget {
                    recipient_id,
                    endpoint_arns,
                })
            })
            .collect())
    }

    async fn send_voip_pushes(
        &self,
        pushes: Vec<(VoipPushTarget, VoipPushPayload)>,
    ) -> HashSet<MacroUserIdStr<'static>> {
        let jobs: Vec<(MacroUserIdStr<'static>, String, VoipPushPayload)> = pushes
            .into_iter()
            .flat_map(|(target, payload)| {
                let recipient_id = target.recipient_id;
                target
                    .endpoint_arns
                    .into_iter()
                    .map(move |arn| (recipient_id.clone(), arn, payload.clone()))
            })
            .collect();

        let mut delivered = HashSet::new();
        for batch in jobs.chunks(VOIP_PUSH_DELIVERY_CONCURRENCY) {
            let results = future::join_all(batch.iter().map(|(user_id, arn, payload)| {
                let user_id = user_id.clone();
                async move {
                    let mobile = &self.mobile;
                    match mobile.send_voip_push(arn, payload).await {
                        Ok(_) => Some(user_id),
                        Err(e) => {
                            tracing::error!(
                                error=?e,
                                "voip push: SNS delivery failed"
                            );
                            None
                        }
                    }
                }
            }))
            .await;
            delivered.extend(results.into_iter().flatten());
        }

        delivered
    }
}
