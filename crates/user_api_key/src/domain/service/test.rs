use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;

use super::{MAX_KEYS_PER_USER, UserApiKeyServiceImpl};
use sha2::Digest;

use crate::domain::models::{
    CreatedUserApiKey, MAX_KEY_NAME_LEN, UserApiKey, UserApiKeyError, UserApiKeyId, UserApiKeyInfo,
    hash_key,
};
use crate::domain::ports::{UserApiKeyService, UserApiKeysRepo};

const USER_A: &str = "macro|user-a@macro.com";
const USER_B: &str = "macro|user-b@macro.com";

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

#[derive(Clone)]
struct StoredKey {
    id: UserApiKeyId,
    name: String,
    created_at: chrono::DateTime<Utc>,
    hash: [u8; 32],
}

#[derive(Clone, Default)]
struct FakeUserApiKeysRepo {
    keys: Arc<Mutex<HashMap<String, Vec<StoredKey>>>>,
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
                set.push(StoredKey {
                    id: UserApiKeyId::generate(),
                    name: format!("seed-{i}"),
                    created_at: Utc::now(),
                    hash: hash_key(&format!("seed-key-{i}")),
                });
            }
        }
        repo
    }

    fn stored_hashes_for(&self, user_id: &str) -> Vec<[u8; 32]> {
        self.keys
            .lock()
            .expect("keys lock poisoned")
            .get(user_id)
            .map(|keys| keys.iter().map(|k| k.hash).collect())
            .unwrap_or_default()
    }
}

impl UserApiKeysRepo for FakeUserApiKeysRepo {
    type Err = FakeRepoError;

    async fn insert_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: UserApiKeyId,
        name: &str,
        hash: &[u8; 32],
    ) -> Result<UserApiKeyInfo, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        let info = UserApiKeyInfo {
            id,
            name: name.to_string(),
            created_at: Utc::now(),
        };
        self.keys
            .lock()
            .expect("keys lock poisoned")
            .entry(user_id.as_ref().to_string())
            .or_default()
            .push(StoredKey {
                id,
                name: name.to_string(),
                created_at: info.created_at,
                hash: *hash,
            });
        Ok(info)
    }

    async fn count_keys(&self, user_id: &MacroUserIdStr<'_>) -> Result<i64, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        Ok(self.stored_hashes_for(user_id.as_ref()).len() as i64)
    }

    async fn list_keys(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<UserApiKeyInfo>, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        Ok(self
            .keys
            .lock()
            .expect("keys lock poisoned")
            .get(user_id.as_ref())
            .map(|keys| {
                keys.iter()
                    .map(|k| UserApiKeyInfo {
                        id: k.id,
                        name: k.name.clone(),
                        created_at: k.created_at,
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    async fn delete_key(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: UserApiKeyId,
    ) -> Result<bool, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        let mut keys = self.keys.lock().expect("keys lock poisoned");
        let Some(set) = keys.get_mut(user_id.as_ref()) else {
            return Ok(false);
        };
        let before = set.len();
        set.retain(|stored| stored.id != id);
        Ok(set.len() < before)
    }

    async fn find_user_id_by_key(
        &self,
        key: &UserApiKey,
    ) -> Result<Option<MacroUserIdStr<'static>>, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        let hash = key.hash();
        let keys = self.keys.lock().expect("keys lock poisoned");
        for (user_id, set) in keys.iter() {
            if set.iter().any(|stored| stored.hash == hash) {
                return Ok(Some(
                    MacroUserIdStr::try_from(user_id.clone()).expect("valid user id"),
                ));
            }
        }
        Ok(None)
    }
}

fn looks_like_generated_key(key: &str) -> bool {
    key.starts_with("mak_")
        && key.len() == "mak_".len() + 64
        && key[4..].chars().all(|ch| ch.is_ascii_hexdigit())
}

#[tokio::test]
async fn create_key_returns_secret_once_and_stores_hash() {
    let repo = FakeUserApiKeysRepo::default();
    let service = UserApiKeyServiceImpl::new(repo.clone());

    let created = service
        .create_key(&user(USER_A), " Laptop ")
        .await
        .expect("create should succeed");
    assert_eq!(created.name, "Laptop");
    assert!(created.created_at <= Utc::now());
    assert!(looks_like_generated_key(&created.key));
    assert!(
        repo.stored_hashes_for(USER_A)
            .contains(&UserApiKey::from_raw(&created.key).hash())
    );
}

#[tokio::test]
async fn create_key_returns_distinct_secrets() {
    let service = UserApiKeyServiceImpl::new(FakeUserApiKeysRepo::default());

    let first = service
        .create_key(&user(USER_A), "one")
        .await
        .expect("first create");
    let second = service
        .create_key(&user(USER_A), "two")
        .await
        .expect("second create");
    assert_ne!(first.key, second.key);
    assert_ne!(first.id, second.id);
}

#[tokio::test]
async fn create_key_rejects_empty_or_too_long_name() {
    let service = UserApiKeyServiceImpl::new(FakeUserApiKeysRepo::default());

    let empty = service
        .create_key(&user(USER_A), "   ")
        .await
        .expect_err("empty name should reject");
    assert!(matches!(empty, UserApiKeyError::BadRequest(_)));

    let too_long = "x".repeat(MAX_KEY_NAME_LEN + 1);
    let err = service
        .create_key(&user(USER_A), &too_long)
        .await
        .expect_err("long name should reject");
    assert!(matches!(err, UserApiKeyError::BadRequest(_)));
}

#[tokio::test]
async fn create_key_rejects_at_cap() {
    let service =
        UserApiKeyServiceImpl::new(FakeUserApiKeysRepo::with_count(USER_A, MAX_KEYS_PER_USER));

    let err = service
        .create_key(&user(USER_A), "overflow")
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
async fn list_keys_returns_id_name_and_created_at() {
    let service = UserApiKeyServiceImpl::new(FakeUserApiKeysRepo::default());

    let created_a = service
        .create_key(&user(USER_A), "A key")
        .await
        .expect("create for A");
    let created_b = service
        .create_key(&user(USER_B), "B key")
        .await
        .expect("create for B");

    let a_keys = service.list_keys(&user(USER_A)).await.expect("list A");
    let b_keys = service.list_keys(&user(USER_B)).await.expect("list B");
    assert_eq!(a_keys.len(), 1);
    assert_eq!(b_keys.len(), 1);
    assert_eq!(a_keys[0].id, created_a.id);
    assert_eq!(a_keys[0].name, "A key");
    assert_eq!(a_keys[0].created_at, created_a.created_at);
    assert_ne!(a_keys[0].id, created_b.id);
    let listed = serde_json::to_string(&a_keys[0]).expect("list json");
    assert!(!listed.contains(&created_a.key));
    assert!(!listed.contains("hash"));
}

#[tokio::test]
async fn delete_key_removes_by_id() {
    let service = UserApiKeyServiceImpl::new(FakeUserApiKeysRepo::default());
    let created = service
        .create_key(&user(USER_A), "to-delete")
        .await
        .expect("create should succeed");

    service
        .delete_key(&user(USER_A), created.id)
        .await
        .expect("delete should succeed");

    let err = service
        .delete_key(&user(USER_A), created.id)
        .await
        .expect_err("second delete should miss");
    assert!(matches!(err, UserApiKeyError::NotFound));
}

#[tokio::test]
async fn delete_key_does_not_remove_another_users_id() {
    let service = UserApiKeyServiceImpl::new(FakeUserApiKeysRepo::default());
    let created = service
        .create_key(&user(USER_A), "owned-by-a")
        .await
        .expect("create for A");

    let err = service
        .delete_key(&user(USER_B), created.id)
        .await
        .expect_err("B must not delete A's key");
    assert!(matches!(err, UserApiKeyError::NotFound));
}

#[tokio::test]
async fn repo_failure_is_internal() {
    let service = UserApiKeyServiceImpl::new(FakeUserApiKeysRepo {
        fail: true,
        ..FakeUserApiKeysRepo::default()
    });

    let err = service
        .create_key(&user(USER_A), "fail")
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

#[test]
fn hash_key_matches_sha256_of_utf8_bytes() {
    let key = UserApiKey::from_raw("mak_secret");
    let expected: [u8; 32] = sha2::Sha256::digest(b"mak_secret").into();
    assert_eq!(key.hash(), expected);
    assert_ne!(hash_key("mak_secret"), hash_key("mak_other"));
}

#[test]
fn list_metadata_json_is_id_name_and_created_at() {
    let key = UserApiKey::from_raw(
        "mak_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    let info = UserApiKeyInfo {
        id: UserApiKeyId::generate(),
        name: "CI".to_string(),
        created_at: Utc::now(),
    };
    let json = serde_json::to_value(&info).expect("serialize info");
    assert!(json.get("key").is_none());
    assert!(json.get("hash").is_none());
    assert!(json.get("prefix").is_none());
    assert!(json.get("id").is_some());
    assert_eq!(json.get("name").and_then(|v| v.as_str()), Some("CI"));
    assert!(json.get("createdAt").is_some());
    assert!(
        !serde_json::to_string(&info)
            .expect("info string")
            .contains(key.expose())
    );

    let created = CreatedUserApiKey::new(info, &key);
    let created_json = serde_json::to_value(&created).expect("serialize created");
    assert_eq!(
        created_json.get("key").and_then(|v| v.as_str()),
        Some(key.expose())
    );
    assert_eq!(
        created_json.get("name").and_then(|v| v.as_str()),
        Some("CI")
    );
    assert!(created_json.get("createdAt").is_some());
}
