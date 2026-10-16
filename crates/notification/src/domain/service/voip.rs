//! Native call push notification service.
//!
//! Delivers iOS PushKit and Android FCM call pushes directly, without queueing
//! or DB persistence. Native clients own incoming-call presentation.

#[cfg(test)]
mod test;

use futures::future;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use crate::domain::models::apple::VoipPushPayload;
use crate::domain::models::mobile::DeviceEndpoint;
use crate::domain::models::{NativeCallPushResult, VoipPushTarget};
use crate::domain::ports::{NotificationRepository, VoipPushDelivery, VoipPushSender};

const VOIP_PUSH_DELIVERY_CONCURRENCY: usize = 32;

/// Direct sender for iOS and Android native call pushes.
pub struct VoipPushServiceImpl<R, M> {
    repository: R,
    mobile: M,
}

impl<R, M> VoipPushServiceImpl<R, M> {
    /// Builds a sender that resolves endpoints through the repository and delivers through SNS.
    pub fn new(repository: R, mobile: M) -> Self {
        Self { repository, mobile }
    }
}

impl<R, M> VoipPushSender for VoipPushServiceImpl<R, M>
where
    R: NotificationRepository,
    M: VoipPushDelivery,
{
    async fn get_voip_push_targets(
        &self,
        recipient_ids: &[MacroUserIdStr<'_>],
    ) -> Result<Vec<VoipPushTarget>, Report> {
        let device_map = self.repository.get_device_endpoints(recipient_ids).await?;

        Ok(device_map
            .into_iter()
            .filter_map(|(recipient_id, endpoints)| {
                endpoints
                    .iter()
                    .any(|endpoint| {
                        matches!(
                            endpoint,
                            DeviceEndpoint::IosVoip(_) | DeviceEndpoint::AndroidNativeCall(_)
                        )
                    })
                    .then_some(VoipPushTarget {
                        recipient_id,
                        endpoints,
                    })
            })
            .collect())
    }

    async fn send_voip_pushes(
        &self,
        pushes: Vec<(VoipPushTarget, VoipPushPayload)>,
    ) -> NativeCallPushResult {
        let platforms: Vec<_> = pushes
            .iter()
            .map(|(target, _)| {
                (
                    target.recipient_id.clone(),
                    target.endpoints.iter().any(|endpoint| {
                        matches!(
                            endpoint,
                            DeviceEndpoint::Ios(_) | DeviceEndpoint::IosVoip(_)
                        )
                    }),
                    target.endpoints.iter().any(|endpoint| {
                        matches!(
                            endpoint,
                            DeviceEndpoint::Android(_) | DeviceEndpoint::AndroidNativeCall(_)
                        )
                    }),
                    target
                        .endpoints
                        .iter()
                        .any(|endpoint| matches!(endpoint, DeviceEndpoint::Android(_))),
                )
            })
            .collect();
        let jobs: Vec<(MacroUserIdStr<'static>, DeviceEndpoint, VoipPushPayload)> = pushes
            .into_iter()
            .flat_map(|(target, payload)| {
                let recipient_id = target.recipient_id;
                target
                    .endpoints
                    .into_iter()
                    .map(move |endpoint| (recipient_id.clone(), endpoint, payload.clone()))
            })
            .collect();

        let mut result = NativeCallPushResult::default();
        for batch in jobs.chunks(VOIP_PUSH_DELIVERY_CONCURRENCY) {
            let results = future::join_all(batch.iter().map(|(user_id, endpoint, payload)| {
                let user_id = user_id.clone();
                async move {
                    let mobile = &self.mobile;
                    let (arn, ios) = match endpoint {
                        DeviceEndpoint::IosVoip(arn) => (arn, true),
                        DeviceEndpoint::AndroidNativeCall(arn) => (arn, false),
                        DeviceEndpoint::Ios(_) | DeviceEndpoint::Android(_) => return None,
                    };
                    match mobile.send_voip_push(arn, &user_id, payload).await {
                        Ok(_) => Some((user_id, ios)),
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
            for (user_id, ios) in results.into_iter().flatten() {
                if ios {
                    result.delivered.ios.insert(user_id);
                } else {
                    result.delivered.android.insert(user_id);
                }
            }
        }

        result.fully_delivered = platforms
            .into_iter()
            .filter_map(|(user_id, ios, android, legacy_android)| {
                (!legacy_android
                    && (!ios || result.delivered.ios.contains(&user_id))
                    && (!android || result.delivered.android.contains(&user_id)))
                .then_some(user_id)
            })
            .collect();
        result
    }
}
