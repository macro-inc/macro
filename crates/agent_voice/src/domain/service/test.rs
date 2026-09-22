use super::*;
use async_trait::async_trait;
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use macro_user_id::cowlike::CowLike;
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

struct Directory(bool);
#[async_trait]
impl AgentVoiceDirectory for Directory {
    async fn is_macro_session(&self, _: Uuid) -> Result<bool> {
        Ok(self.0)
    }
}

#[derive(Default)]
struct Store(Mutex<Option<VoiceLease>>, Mutex<HashMap<Uuid, VoiceLease>>);
#[async_trait]
impl VoiceLeaseStore for Store {
    async fn claim(&self, lease: &VoiceLease) -> Result<Option<VoiceLease>> {
        let mut record = self.0.lock().unwrap();
        if let Some(ended) = self.1.lock().unwrap().get(&lease.client_session_id) {
            return Ok(Some(ended.clone()));
        }
        if record.is_some() {
            return Ok(record.clone());
        }
        *record = Some(lease.clone());
        Ok(None)
    }
    async fn get(&self, _: Uuid) -> Result<Option<VoiceLease>> {
        Ok(self.0.lock().unwrap().clone())
    }
    async fn transition(
        &self,
        _: Uuid,
        voice: VoiceSessionId,
        from: LeaseState,
        to: LeaseState,
    ) -> Result<bool> {
        let mut record = self.0.lock().unwrap();
        let Some(lease) = record.as_mut() else {
            return Ok(false);
        };
        if lease.voice_session_id != voice || lease.state != from {
            return Ok(false);
        }
        lease.state = to;
        Ok(true)
    }
    async fn release(&self, _: Uuid, voice: VoiceSessionId) -> Result<()> {
        let mut record = self.0.lock().unwrap();
        if record
            .as_ref()
            .is_some_and(|lease| lease.voice_session_id == voice)
        {
            let mut ended = record.take().unwrap();
            ended.state = LeaseState::Ending;
            self.1
                .lock()
                .unwrap()
                .insert(ended.client_session_id, ended);
        }
        Ok(())
    }
}

#[derive(Default)]
struct Media {
    provisions: AtomicUsize,
    closes: AtomicUsize,
    fail_provision: AtomicBool,
    fail_close: AtomicBool,
    room_gone: AtomicBool,
}
#[async_trait]
impl VoiceMedia for Media {
    async fn provision(&self, _: &VoiceLease) -> Result<()> {
        self.provisions.fetch_add(1, Ordering::SeqCst);
        if self.fail_provision.load(Ordering::SeqCst) {
            Err(VoiceError::Infrastructure(rootcause::report!(
                "dispatch failed"
            )))
        } else {
            Ok(())
        }
    }
    async fn close(&self, _: &VoiceLease) -> Result<()> {
        self.closes.fetch_add(1, Ordering::SeqCst);
        if self.fail_close.load(Ordering::SeqCst) {
            Err(VoiceError::Infrastructure(rootcause::report!(
                "cleanup failed"
            )))
        } else {
            Ok(())
        }
    }
    async fn is_open(&self, _: &VoiceLease) -> Result<bool> {
        Ok(!self.room_gone.load(Ordering::SeqCst))
    }
    fn token(&self, _: &VoiceLease, ttl: u32) -> Result<String> {
        assert!(ttl > 0 && ttl <= JOIN_TOKEN_SECONDS);
        Ok("scoped-test-token".into())
    }
    fn url(&self) -> &str {
        "wss://voice.example"
    }
}

fn receipt(user: &str) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        macro_user_id::user_id::MacroUserIdStr::parse_from_str(user)
            .unwrap()
            .into_owned(),
        Entity {
            entity_id: Uuid::from_u128(7).to_string(),
            entity_type: EntityType::AgentSession,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn request() -> StartVoice {
    StartVoice {
        voice: Voice::Marin,
        client_session_id: macro_uuid::generate_uuid_v7(),
    }
}
fn fixture(eligible: bool) -> (AgentVoiceService, Arc<Store>, Arc<Media>) {
    let store = Arc::new(Store::default());
    let media = Arc::new(Media::default());
    (
        AgentVoiceService::new(Arc::new(Directory(eligible)), store.clone(), media.clone()),
        store,
        media,
    )
}

#[tokio::test]
async fn retry_reuses_room_and_dispatch_but_another_controller_conflicts() {
    let (service, _, media) = fixture(true);
    let request = request();
    let first = service
        .start(receipt("macro|alice@example.com"), request.clone())
        .await
        .unwrap();
    let retry = service
        .start(receipt("macro|alice@example.com"), request.clone())
        .await
        .unwrap();
    assert_eq!(first.voice_session_id, retry.voice_session_id);
    assert_eq!(first.expires_at, retry.expires_at);
    assert_eq!(media.provisions.load(Ordering::SeqCst), 1);
    assert!(matches!(
        service
            .start(receipt("macro|bob@example.com"), request)
            .await,
        Err(VoiceError::Conflict)
    ));
}

#[tokio::test]
async fn only_controller_can_end_and_old_end_cannot_close_new_room() {
    let (service, _, media) = fixture(true);
    let first = service
        .start(receipt("macro|alice@example.com"), request())
        .await
        .unwrap();
    assert!(matches!(
        service
            .end(receipt("macro|bob@example.com"), first.voice_session_id)
            .await,
        Err(VoiceError::Forbidden)
    ));
    service
        .end(receipt("macro|alice@example.com"), first.voice_session_id)
        .await
        .unwrap();
    let second = service
        .start(receipt("macro|alice@example.com"), request())
        .await
        .unwrap();
    service
        .end(receipt("macro|alice@example.com"), first.voice_session_id)
        .await
        .unwrap();
    assert_ne!(first.voice_session_id, second.voice_session_id);
    assert_eq!(media.closes.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn macro_harness_always_advertises_voice_without_provisioning() {
    let (service, store, media) = fixture(true);
    let options = service
        .options(receipt("macro|alice@example.com"))
        .await
        .unwrap();
    assert!(options.enabled);
    assert_eq!(options.voices.len(), Voice::catalog().len());
    assert_eq!(options.max_duration_seconds, MAX_DURATION_SECONDS);
    assert_eq!(media.provisions.load(Ordering::SeqCst), 0);
    assert!(store.0.lock().unwrap().is_none());
}

#[tokio::test]
async fn external_harnesses_never_provision() {
    let (service, _, media) = fixture(false);
    assert!(
        !service
            .options(receipt("macro|alice@example.com"))
            .await
            .unwrap()
            .enabled
    );
    assert!(matches!(
        service
            .start(receipt("macro|alice@example.com"), request())
            .await,
        Err(VoiceError::UnsupportedHarness)
    ));
    assert_eq!(media.provisions.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn failed_dispatch_cleans_room_before_releasing_controller() {
    let (service, store, media) = fixture(true);
    media.fail_provision.store(true, Ordering::SeqCst);
    assert!(
        service
            .start(receipt("macro|alice@example.com"), request())
            .await
            .is_err()
    );
    assert_eq!(media.closes.load(Ordering::SeqCst), 1);
    assert!(store.0.lock().unwrap().is_none());
    media.fail_close.store(true, Ordering::SeqCst);
    assert!(
        service
            .start(receipt("macro|alice@example.com"), request())
            .await
            .is_err()
    );
    assert!(store.0.lock().unwrap().is_some());
    assert_eq!(
        store.0.lock().unwrap().as_ref().unwrap().state,
        LeaseState::Ending
    );
}

#[tokio::test]
async fn concurrent_starts_dispatch_once() {
    let (service, _, media) = fixture(true);
    let request = request();
    let (first, second) = tokio::join!(
        service.start(receipt("macro|alice@example.com"), request.clone()),
        service.start(receipt("macro|alice@example.com"), request)
    );
    assert!(first.is_ok() || second.is_ok());
    assert_eq!(media.provisions.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn ended_request_is_never_restarted_and_cannot_close_a_new_room() {
    let (service, _, media) = fixture(true);
    let request = request();
    let first = service
        .start(receipt("macro|alice@example.com"), request.clone())
        .await
        .unwrap();
    service
        .end(receipt("macro|alice@example.com"), first.voice_session_id)
        .await
        .unwrap();
    let new_request = StartVoice {
        client_session_id: macro_uuid::generate_uuid_v7(),
        ..request.clone()
    };
    let second = service
        .start(receipt("macro|alice@example.com"), new_request.clone())
        .await
        .unwrap();
    assert!(matches!(
        service
            .start(receipt("macro|alice@example.com"), request)
            .await,
        Err(VoiceError::Ended)
    ));
    let current = service
        .start(receipt("macro|alice@example.com"), new_request)
        .await
        .unwrap();
    assert_eq!(current.voice_session_id, second.voice_session_id);
    assert_eq!(media.provisions.load(Ordering::SeqCst), 2);
    assert_eq!(media.closes.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn worker_departure_releases_the_controller_for_a_new_conversation() {
    let (service, _, media) = fixture(true);
    let first_request = request();
    let first = service
        .start(receipt("macro|alice@example.com"), first_request.clone())
        .await
        .unwrap();
    media.room_gone.store(true, Ordering::SeqCst);
    let second = service
        .start(receipt("macro|alice@example.com"), request())
        .await
        .unwrap();
    media.room_gone.store(false, Ordering::SeqCst);
    assert_ne!(first.voice_session_id, second.voice_session_id);
    assert_eq!(media.provisions.load(Ordering::SeqCst), 2);
    assert!(matches!(
        service
            .start(receipt("macro|alice@example.com"), first_request)
            .await,
        Err(VoiceError::Ended)
    ));
    assert_eq!(media.closes.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn failed_end_keeps_controller_until_cleanup_succeeds() {
    let (service, store, media) = fixture(true);
    let first_request = request();
    let first = service
        .start(receipt("macro|alice@example.com"), first_request.clone())
        .await
        .unwrap();
    media.fail_close.store(true, Ordering::SeqCst);
    assert!(
        service
            .end(receipt("macro|alice@example.com"), first.voice_session_id)
            .await
            .is_err()
    );
    assert_eq!(
        store.0.lock().unwrap().as_ref().unwrap().state,
        LeaseState::Ending
    );
    assert!(matches!(
        service
            .start(receipt("macro|alice@example.com"), first_request)
            .await,
        Err(VoiceError::Ended)
    ));
    assert!(matches!(
        service
            .start(receipt("macro|alice@example.com"), request())
            .await,
        Err(VoiceError::Conflict)
    ));
    media.fail_close.store(false, Ordering::SeqCst);
    service
        .end(receipt("macro|alice@example.com"), first.voice_session_id)
        .await
        .unwrap();
    assert!(store.0.lock().unwrap().is_none());
}

#[tokio::test]
async fn a_receipt_for_another_entity_type_cannot_start_voice() {
    let (service, _, media) = fixture(true);
    let access = EntityAccessReceipt::try_new_authenticated_user(
        macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|alice@example.com")
            .unwrap()
            .into_owned(),
        Entity {
            entity_id: Uuid::from_u128(7).to_string(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap();
    assert!(matches!(
        service.start(access, request()).await,
        Err(VoiceError::Forbidden)
    ));
    assert_eq!(media.provisions.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn internal_receipts_cannot_mint_browser_credentials() {
    let (service, _, media) = fixture(true);
    let access = EntityAccessReceipt::dangerously_assert_internal_user(
        &Uuid::from_u128(7).to_string(),
        EntityType::AgentSession,
    );
    assert!(matches!(
        service.start(access, request()).await,
        Err(VoiceError::Forbidden)
    ));
    assert_eq!(media.provisions.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_failed_end_can_be_reclaimed_after_the_worker_removes_the_room() {
    let (service, _, media) = fixture(true);
    let first = service
        .start(receipt("macro|alice@example.com"), request())
        .await
        .unwrap();
    media.fail_close.store(true, Ordering::SeqCst);
    assert!(
        service
            .end(receipt("macro|alice@example.com"), first.voice_session_id)
            .await
            .is_err()
    );
    media.fail_close.store(false, Ordering::SeqCst);
    media.room_gone.store(true, Ordering::SeqCst);
    let second = service
        .start(receipt("macro|alice@example.com"), request())
        .await
        .unwrap();
    assert_ne!(first.voice_session_id, second.voice_session_id);
    assert_eq!(media.provisions.load(Ordering::SeqCst), 2);
}
