//! VoIP push notification service.
//!
//! Sends PushKit VoIP pushes directly (no queue, no DB persistence) so that
//! CallKit can display the native incoming-call UI on iOS.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::apple::VoipPushPayload;
use crate::domain::models::mobile::DeviceEndpoint;
use crate::domain::ports::{NotificationRepository, VoipPushSender};
use crate::outbound::mobile::MobilePushAdapter;
use crate::outbound::mobile::MobilePushOps;

/// Concrete implementation of [`VoipPushSender`].
///
/// Looks up VoIP device endpoints from the repository, then dispatches each
/// push directly via SNS APNS_VOIP — no queue, no persistence.
pub struct VoipPushServiceImpl<R, P> {
    repository: R,
    mobile: MobilePushAdapter<P>,
}

impl<R, P> VoipPushServiceImpl<R, P> {
    /// Create a new [`VoipPushServiceImpl`].
    pub fn new(repository: R, mobile: MobilePushAdapter<P>) -> Self {
        Self { repository, mobile }
    }
}

impl<R, P> VoipPushSender for VoipPushServiceImpl<R, P>
where
    R: NotificationRepository,
    P: MobilePushOps + Send + Sync + 'static,
{
    async fn send_voip_push(
        &self,
        recipient_ids: &[MacroUserIdStr<'_>],
        payload: &VoipPushPayload,
    ) -> HashSet<MacroUserIdStr<'static>> {
        let device_map = match self.repository.get_device_endpoints(recipient_ids).await {
            Ok(m) => m,
            Err(e) => {
                tracing::error!(error=?e, "voip push: failed to fetch device endpoints");
                return HashSet::new();
            }
        };

        let mut delivered_user_ids = HashSet::new();
        for (user_id, endpoints) in &device_map {
            for endpoint in endpoints {
                let DeviceEndpoint::IosVoip(arn) = endpoint else {
                    continue;
                };
                match self.mobile.send_voip_push(arn, payload).await {
                    Ok(_) => {
                        delivered_user_ids.insert(user_id.clone());
                    }
                    Err(e) => {
                        tracing::error!(
                            error=?e,
                            user_id=%user_id,
                            "voip push: SNS delivery failed"
                        );
                    }
                }
            }
        }

        delivered_user_ids
    }
}
