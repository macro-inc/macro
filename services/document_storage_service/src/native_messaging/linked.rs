//! Optional personal-device composition, owned by the DSS task tracker.
use meta_messaging::{
    domain::{
        linked::{models::Features, service::LinkedService},
        service::MessagingService,
    },
    outbound::linked::{
        replies::LinkedReplies, repository::PgLinkedRepository, sessions::HttpSessions,
    },
};
use std::{sync::Arc, time::Duration};

pub(super) struct Settings {
    pub features: Features,
    pub sessions: Option<Arc<HttpSessions>>,
}
impl Settings {
    pub fn load() -> anyhow::Result<Self> {
        fn enabled(value: Option<String>) -> anyhow::Result<bool> {
            match value.as_deref() {
                None | Some("false") => Ok(false),
                Some("true") => Ok(true),
                _ => anyhow::bail!("WhatsApp linked switches require true or false"),
            }
        }
        let config = macro_config::ConfigLoader::load::<crate::config::LinkedConfig>()?;
        let features = Features {
            pairing: enabled(
                config
                    .whatsapp_linked_pairing_enabled
                    .value()
                    .map(str::to_owned),
            )?,
            adoption: enabled(
                config
                    .whatsapp_linked_adoption_enabled
                    .value()
                    .map(str::to_owned),
            )?,
            sending: enabled(
                config
                    .whatsapp_linked_sending_enabled
                    .value()
                    .map(str::to_owned),
            )?,
        };
        let identity = config
            .whatsapp_session_client_identity_pem
            .value()
            .map(str::to_owned)
            .filter(|value| !value.is_empty())
            .map(zeroize::Zeroizing::new);
        let ca = config
            .whatsapp_session_ca_pem
            .value()
            .map(str::to_owned)
            .filter(|value| !value.is_empty());
        let sessions = match (identity, ca) {
            (None, None) => None,
            (Some(identity), Some(ca)) => Some(Arc::new(HttpSessions::new(
                macro_service_urls::WhatsAppSessionServiceUrl::new()?
                    .to_string()
                    .parse()?,
                reqwest::Identity::from_pem(identity.as_bytes())?,
                reqwest::Certificate::from_pem(ca.as_bytes())?,
            )?)),
            _ => anyhow::bail!("configure both WhatsApp session mTLS identity and CA"),
        };
        anyhow::ensure!(
            !(features.pairing || features.adoption || features.sending) || sessions.is_some(),
            "enabled WhatsApp linked operations require authenticated session RPC"
        );
        Ok(Self { features, sessions })
    }
}
pub(super) fn build(
    settings: Settings,
    repository: Arc<PgLinkedRepository>,
    sessions: Arc<HttpSessions>,
    native: Arc<super::native::NativeChannels>,
) -> Arc<LinkedService> {
    let replies = Arc::new(LinkedReplies {
        repository: repository.clone(),
        sessions: sessions.clone(),
    });
    let messaging = Arc::new(MessagingService::new(
        repository.clone(),
        replies.clone(),
        replies,
        native.clone(),
    ));
    Arc::new(LinkedService::new(
        settings.features,
        messaging,
        repository,
        sessions,
        native,
    ))
}
pub(super) fn spawn(
    service: Arc<LinkedService>,
    tracker: tokio_util::task::TaskTracker,
    cancellation: tokio_util::sync::CancellationToken,
) {
    let sends = (*service.messaging).clone();
    let stop = cancellation.clone();
    // The existing worker claims and drives the same durable send lifecycle.
    tracker.spawn(super::workers::sends(
        sends,
        Arc::new(tokio::sync::Notify::new()),
        stop,
    ));
    let maintenance = service.clone();
    let stop = cancellation.clone();
    tracker.spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(5));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {_=stop.cancelled()=>break,_=tick.tick()=>{}}
            if let Err(error) = maintenance.maintain_sessions().await {
                tracing::warn!(
                    code = error.current_context().code(),
                    "Linked session control will retry"
                );
            }
        }
    });
    tracker.spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(5));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {_=cancellation.cancelled()=>break,_=tick.tick()=>{}}
            if let Err(error) = service.reconcile().await {
                tracing::warn!(
                    code = error.current_context().code(),
                    "Linked session reconciliation will retry"
                );
            }
            if let Err(error) = service.messaging.recover_native().await {
                tracing::warn!(
                    code = error.current_context().code(),
                    "Linked native recovery will retry"
                );
            }
        }
    });
}
