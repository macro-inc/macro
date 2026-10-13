//! Best-effort channel media and notifications after room allocation.

use super::*;
use tracing::Instrument;

pub(super) struct ChannelCallStartup<R, C, Cn, E, N, V> {
    pub repo: R,
    pub rtc_client: Arc<C>,
    pub connection_service: Arc<Cn>,
    pub entity_access_service: E,
    pub notification_ingress: Arc<N>,
    pub voip_push_sender: Arc<V>,
    pub server_url: String,
    pub ring_status_base_url: Option<String>,
    pub egress_s3_config: Option<EgressS3Config>,
}

impl<
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
    V: VoipPushSender,
> ChannelCallStartup<R, C, Cn, E, N, V>
{
    pub fn spawn(
        self,
        call: Call,
        channel_id: Uuid,
        user_id: MacroUserIdStr<'static>,
    ) -> tokio::task::JoinHandle<()> {
        let span = tracing::info_span!("start_channel_call", call_id = %call.id, %channel_id);
        tokio::spawn(async move {
            let transcription = async {
                self.rtc_client.dispatch_transcription_agent(&call.room_name).await
                    .inspect_err(|error| tracing::error!(error=?error, "failed to dispatch transcription agent")).ok();
            };
            let recording = meetings::start_meeting_recording(&self.repo, self.rtc_client.as_ref(), call.id, &call.room_name, self.egress_s3_config.as_ref());
            let notifications = async {
                self.notify(&call, &channel_id, user_id).await
                    .inspect_err(|error| tracing::error!(error=?error, "failed to send call started notification")).ok();
            };
            tokio::join!(transcription, recording, notifications);
        }.instrument(span))
    }

    #[tracing::instrument(err, skip_all, fields(call_id = %call.id))]
    async fn notify(
        &self,
        call: &Call,
        channel_id: &Uuid,
        user_id: MacroUserIdStr<'_>,
    ) -> anyhow::Result<()> {
        let channel_id_str = channel_id.to_string();
        let recipient_ids: HashSet<MacroUserIdStr<'_>> = self
            .entity_access_service
            .get_users_by_entity(&channel_id_str, EntityType::Channel)
            .await?
            .into_iter()
            .filter(|u| u.as_ref() != user_id.as_ref())
            .collect();
        if recipient_ids.is_empty() {
            return Ok(());
        }
        // Do not start ringing a call that ended while resolving its recipients.
        if self
            .repo
            .get_call_by_id(&call.id)
            .await
            .map_err(Into::into)?
            .is_none()
        {
            return Ok(());
        }
        let users: Vec<_> = recipient_ids.iter().map(CowLike::copied).collect();
        self.connection_service
            .send_channel_message(
                &users,
                "call_started",
                serde_json::json!({
                    "channel_id": channel_id, "call_id": call.id, "created_by": user_id,
                }),
            )
            .await
            .inspect_err(|error| tracing::error!(error=?error, "failed to send call started event"))
            .ok();

        // Resolve the channel name from each recipient's
        // perspective: a DM is named after the other
        // participant, so the caller's view of the name
        // would be the callee's own name.
        let recipient_vec: Vec<MacroUserIdStr<'static>> = recipient_ids
            .iter()
            .cloned()
            .map(CowLike::into_owned)
            .collect();
        let channel_names_by_recipient = self
            .repo
            .resolve_channel_name_for_viewers(channel_id, &recipient_vec)
            .await
            .map_err(Into::into)?;

        let sender_profile_picture_url = self
            .repo
            .get_user_profile_picture(user_id.copied())
            .await
            .ok()
            .flatten();

        let caller_name = self
            .repo
            .get_user_display_name(user_id.copied())
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| user_id.email_str().to_string());

        // Send VoIP push for the native iOS incoming-call sheet first.
        // Recipients with successful VoIP delivery do not need the regular
        // APNS alert banner as well.

        // Resolve VoIP endpoints before minting tokens:
        // users without PushKit endpoints should not get
        // LiveKit tokens minted for them. If endpoint
        // resolution fails, fall back to normal APNS for
        // everyone rather than dropping the notification.
        let voip_targets = match self
            .voip_push_sender
            .get_voip_push_targets(&recipient_vec)
            .await
        {
            Ok(targets) => targets,
            Err(e) => {
                tracing::error!(
                    error=?e,
                    "failed to resolve VoIP push targets; falling back to APNS"
                );
                Vec::new()
            }
        };
        let ring_status_url = self.ring_status_base_url.as_deref().map(|base| {
            format!(
                "{}/call/ring-status/{}",
                base.trim_end_matches('/'),
                call.id
            )
        });
        // One payload batch per distinct channel name, so
        // each recipient's native sheet shows the name they
        // know the channel by.
        let mut payloads_by_recipient: HashMap<MacroUserIdStr<'static>, VoipPushPayload> =
            HashMap::new();
        let voip_groups = group_recipients_by_channel_name(
            voip_targets
                .iter()
                .map(|target| target.recipient_id.clone()),
            &channel_names_by_recipient,
        );
        for (voip_channel_name, voip_group_recipients) in voip_groups {
            let voip_group_recipients: Vec<MacroUserIdStr<'static>> =
                voip_group_recipients.into_iter().collect();
            let payloads = self
                .rtc_client
                .build_voip_push_payloads(VoipPushPayloadRequest {
                    recipients: &voip_group_recipients,
                    room_name: &call.room_name,
                    call_id: call.id,
                    channel_id: &channel_id_str,
                    channel_name: voip_channel_name.as_deref().unwrap_or(""),
                    caller_name: &caller_name,
                    livekit_server_url: &self.server_url,
                    ring_status_url: ring_status_url.as_deref(),
                })
                .await;
            payloads_by_recipient.extend(payloads);
        }
        // Rejoin resolved endpoints with successfully
        // minted payloads. A failed token mint skips only
        // that recipient's VoIP push.
        let pushes = voip_targets
            .into_iter()
            .filter_map(|target| {
                payloads_by_recipient
                    .remove(&target.recipient_id)
                    .map(|payload| (target, payload))
            })
            .collect();

        let voip_recipient_ids = self.voip_push_sender.send_voip_pushes(pushes).await;

        let apns_recipient_ids = exclude_voip_recipients(recipient_ids, &voip_recipient_ids);

        // APNS is the fallback/default path. Recipients
        // with a successful VoIP delivery skip the regular
        // alert to avoid duplicate incoming-call UI. One
        // request per distinct channel name, so the alert
        // title and stored metadata match what each
        // recipient calls the channel.
        let apns_groups =
            group_recipients_by_channel_name(apns_recipient_ids, &channel_names_by_recipient);
        for (channel_name, apns_group_recipients) in apns_groups {
            let req = SendNotificationRequestBuilder {
                notification_entity: EntityType::Channel.with_entity_string(channel_id_str.clone()),
                secondary_notification_entity: None,
                notification: CallStartedNotification {
                    sender_profile_picture_url: sender_profile_picture_url.clone(),
                    channel_name,
                },
                sender_id: Some(user_id.copied()),
                recipient_ids: apns_group_recipients,
            }
            .into_request()
            .with_apns();

            self.notification_ingress
                .send_notification(req)
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
        }
        Ok(())
    }
}
