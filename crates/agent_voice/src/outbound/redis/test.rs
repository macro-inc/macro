use super::*;
use crate::domain::model::Voice;
use macro_user_id::cowlike::CowLike;
use std::sync::Arc;

#[tokio::test]
async fn shared_claims_fence_competing_controllers_and_ended_retries() {
    let url = macro_env_var::optional_read_env_var("REDIS_URI")
        .unwrap()
        .unwrap_or_else(|| "redis://127.0.0.1:6379".to_owned());
    let store = Arc::new(RedisVoiceLeaseStore::new(redis::Client::open(url).unwrap()));
    let session_id = macro_uuid::generate_uuid_v7();
    let lease = VoiceLease {
        session_id,
        voice_session_id: VoiceSessionId(macro_uuid::generate_uuid_v7()),
        owner: macro_user_id::user_id::MacroUserIdStr::parse_from_str(
            "macro|voice-test@example.com",
        )
        .unwrap()
        .into_owned(),
        client_session_id: macro_uuid::generate_uuid_v7(),
        voice: Voice::Marin,
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(30),
        state: LeaseState::Starting,
    };
    let mut tasks = tokio::task::JoinSet::new();
    for _ in 0..12 {
        let store = store.clone();
        let lease = VoiceLease {
            voice_session_id: VoiceSessionId(macro_uuid::generate_uuid_v7()),
            client_session_id: macro_uuid::generate_uuid_v7(),
            ..lease.clone()
        };
        tasks.spawn(async move { store.claim(&lease).await.unwrap() });
    }
    let mut winners = 0;
    while let Some(result) = tasks.join_next().await {
        winners += usize::from(result.unwrap().is_none());
    }
    assert_eq!(winners, 1);
    let current = store.get(session_id).await.unwrap().unwrap();
    assert!(
        store
            .transition(
                session_id,
                current.voice_session_id,
                LeaseState::Starting,
                LeaseState::Active
            )
            .await
            .unwrap()
    );
    assert!(
        !store
            .transition(
                session_id,
                current.voice_session_id,
                LeaseState::Starting,
                LeaseState::Active
            )
            .await
            .unwrap()
    );
    store
        .release(session_id, lease.voice_session_id)
        .await
        .unwrap();
    assert!(store.get(session_id).await.unwrap().is_some());
    store
        .release(session_id, current.voice_session_id)
        .await
        .unwrap();
    assert!(store.get(session_id).await.unwrap().is_none());
    let retry = store.claim(&current).await.unwrap().unwrap();
    assert_eq!(retry.voice_session_id, current.voice_session_id);
    assert_eq!(retry.state, LeaseState::Ending);
    assert!(store.claim(&lease).await.unwrap().is_none());
    store
        .release(session_id, current.voice_session_id)
        .await
        .unwrap();
    assert_eq!(
        store
            .get(session_id)
            .await
            .unwrap()
            .unwrap()
            .voice_session_id,
        lease.voice_session_id
    );
    let mut connection = store.connection().await.unwrap();
    let _: usize = redis::cmd("DEL")
        .arg(lease_key(session_id))
        .arg(ended_key(session_id, current.client_session_id))
        .query_async(&mut connection)
        .await
        .unwrap();
}
