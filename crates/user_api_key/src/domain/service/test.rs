use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use macro_user_id::user_id::MacroUserIdStr;

use super::{MAX_KEYS_PER_USER, UserApiKeyServiceImpl};
use crate::domain::models::{UserApiKey, UserApiKeyError};
use crate::domain::ports::{UserApiKeyService, UserApiKeysRepo};

const USER_A: &str = "macro|user-a@macro.com";
const USER_B: &str = "macro|user-b@macro.com";

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

#[derive(Clone, Default)]
struct FakeUserApiKeysRepo {
    keys: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    fail: bool,
}

#[derive(Debug, thiserror::Error)]
#[error("fake user api key repository error")]
struct FakeRepoError;

impl FakeUserApiKeysRepo {
    fn with_count(user_id: &str, count: usize) -> Self {
        let repo = Self::default();
        {
            let mut keys = repo.keys.lock().expect("keys lock poisoned");
            let set = keys.entry(user_id.to_string()).or_default();
            for i in 0..count {
                set.insert(format!("seed-key-{i}"));
            }
        }
        repo
    }

    fn stored_for(&self, user_id: &str) -> HashSet<String> {
        self.keys
            .lock()
            .expect("keys lock poisoned")
            .get(user_id)
            .cloned()
            .unwrap_or_default()
    }
}

impl UserApiKeysRepo for FakeUserApiKeysRepo {
    type Err = FakeRepoError;

    async fn insert_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        key: &UserApiKey,
    ) -> Result<(), Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        self.keys
            .lock()
            .expect("keys lock poisoned")
            .entry(user_id.as_ref().to_string())
            .or_default()
            .insert(key.expose().to_string());
        Ok(())
    }

    async fn count_keys(&self, user_id: &MacroUserIdStr<'_>) -> Result<i64, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        Ok(self.stored_for(user_id.as_ref()).len() as i64)
    }

    async fn list_keys(&self, user_id: &MacroUserIdStr<'_>) -> Result<Vec<UserApiKey>, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        let mut keys: Vec<_> = self
            .stored_for(user_id.as_ref())
            .into_iter()
            .map(UserApiKey::from_raw)
            .collect();
        keys.sort_by(|a, b| a.expose().cmp(b.expose()));
        Ok(keys)
    }

    async fn delete_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        key: &UserApiKey,
    ) -> Result<bool, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        Ok(self
            .keys
            .lock()
            .expect("keys lock poisoned")
            .get_mut(user_id.as_ref())
            .is_some_and(|set| set.remove(key.expose())))
    }

    async fn find_user_id_by_key(
        &self,
        key: &UserApiKey,
    ) -> Result<Option<MacroUserIdStr<'static>>, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        let keys = self.keys.lock().expect("keys lock poisoned");
        for (user_id, set) in keys.iter() {
            if set.contains(key.expose()) {
                return Ok(Some(
                    MacroUserIdStr::try_from(user_id.clone()).expect("valid user id"),
                ));
            }
        }
        Ok(None)
    }
}

fn looks_like_generated_key(key: &UserApiKey) -> bool {
    let raw = key.expose();
    raw.starts_with("mak_")
        && raw.len() == "mak_".len() + 64
        && raw[4..].chars().all(|ch| ch.is_ascii_hexdigit())
}

#[tokio::test]
async fn create_key_returns_generated_shape_and_persists() {
    let repo = FakeUserApiKeysRepo::default();
    let service = UserApiKeyServiceImpl::new(repo.clone());

    let key = service
        .create_key(&user(USER_A))
        .await
        .expect("create should succeed");
    assert!(looks_like_generated_key(&key));
    assert!(repo.stored_for(USER_A).contains(key.expose()));
}

#[tokio::test]
async fn create_key_returns_distinct_secrets() {
    let service = UserApiKeyServiceImpl::new(FakeUserApiKeysRepo::default());

    let first = service
        .create_key(&user(USER_A))
        .await
        .expect("first create");
    let second = service
        .create_key(&user(USER_A))
        .await
        .expect("second create");
    assert_ne!(first.expose(), second.expose());
}

#[tokio::test]
async fn create_key_rejects_at_cap() {
    let service =
        UserApiKeyServiceImpl::new(FakeUserApiKeysRepo::with_count(USER_A, MAX_KEYS_PER_USER));

    let err = service
        .create_key(&user(USER_A))
        .await
        .expect_err("cap should reject");
    match err {
        UserApiKeyError::BadRequest(message) => {
            assert!(message.contains(&MAX_KEYS_PER_USER.to_string()));
        }
        other => panic!("expected BadRequest, got {other:?}"),
    }
}

#[tokio::test]
async fn list_keys_is_scoped_to_caller() {
    let repo = FakeUserApiKeysRepo::default();
    let service = UserApiKeyServiceImpl::new(repo);

    service
        .create_key(&user(USER_A))
        .await
        .expect("create for A");
    service
        .create_key(&user(USER_B))
        .await
        .expect("create for B");

    let a_keys = service.list_keys(&user(USER_A)).await.expect("list A");
    let b_keys = service.list_keys(&user(USER_B)).await.expect("list B");
    assert_eq!(a_keys.len(), 1);
    assert_eq!(b_keys.len(), 1);
    assert_ne!(a_keys[0].expose(), b_keys[0].expose());
}

#[tokio::test]
async fn delete_key_removes_row_and_misses_are_not_found() {
    let service = UserApiKeyServiceImpl::new(FakeUserApiKeysRepo::default());
    let key = service
        .create_key(&user(USER_A))
        .await
        .expect("create should succeed");

    service
        .delete_key(&user(USER_A), &key)
        .await
        .expect("delete should succeed");

    let err = service
        .delete_key(&user(USER_A), &key)
        .await
        .expect_err("second delete should miss");
    assert!(matches!(err, UserApiKeyError::NotFound));
}

#[tokio::test]
async fn repo_failure_is_internal() {
    let service = UserApiKeyServiceImpl::new(FakeUserApiKeysRepo {
        fail: true,
        ..FakeUserApiKeysRepo::default()
    });

    let err = service
        .create_key(&user(USER_A))
        .await
        .expect_err("failure should surface");
    assert!(matches!(err, UserApiKeyError::Internal(_)));
}

#[test]
fn debug_does_not_contain_full_secret() {
    let key = UserApiKey::from_raw(
        "mak_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    let debug = format!("{key:?}");
    assert!(!debug.contains(key.expose()));
    assert!(debug.starts_with("mak_…"));
    assert!(debug.ends_with("cdef"));
}
