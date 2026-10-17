use std::sync::Mutex;

use entity_access::domain::models::{Entity, EntityPermission, TeamRole};

use super::*;
use crate::domain::models::{EncryptedProviderApiKey, StoredMemberKey};

const TEAM: &str = "00000000-0000-0000-0000-0000000000aa";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|member@example.com".to_owned()).expect("valid user id")
}

fn receipt<T: RequiredPermission>(role: TeamRole) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: TEAM.to_owned(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole { role },
    )
    .expect("the role satisfies the requirement")
}

#[derive(Default)]
struct FakeRepo {
    stored: Mutex<Vec<(Uuid, ModelProvider, String)>>,
}

#[async_trait::async_trait]
impl ProviderKeyRepo for FakeRepo {
    async fn upsert(
        &self,
        team_id: Uuid,
        provider: ModelProvider,
        _encrypted: &EncryptedProviderApiKey,
        key_prefix: &str,
    ) -> Result<TeamProviderKeyStatus> {
        self.stored
            .lock()
            .expect("lock")
            .push((team_id, provider, key_prefix.to_owned()));
        Ok(TeamProviderKeyStatus {
            provider,
            updated_at: chrono::Utc::now(),
        })
    }

    async fn list(&self, _team_id: Uuid) -> Result<Vec<TeamProviderKeyStatus>> {
        Ok(Vec::new())
    }

    async fn delete(&self, _team_id: Uuid, _provider: ModelProvider) -> Result<bool> {
        Ok(true)
    }

    async fn for_member(
        &self,
        _user: &MacroUserIdStr<'_>,
        _provider: ModelProvider,
    ) -> Result<Option<StoredMemberKey>> {
        Ok(None)
    }

    async fn providers_for_member(&self, _user: &MacroUserIdStr<'_>) -> Result<Vec<ModelProvider>> {
        Ok(Vec::new())
    }
}

#[derive(Default)]
struct FakeCipher {
    encrypted: Mutex<usize>,
}

#[async_trait::async_trait]
impl ProviderKeyCipher for FakeCipher {
    async fn encrypt(
        &self,
        _team_id: Uuid,
        _key: &ProviderApiKey,
    ) -> Result<EncryptedProviderApiKey> {
        *self.encrypted.lock().expect("lock") += 1;
        Ok(EncryptedProviderApiKey {
            key_ciphertext: vec![1],
            encryption_version: 1,
            kms_key_id: "kms".to_owned(),
        })
    }

    async fn decrypt(
        &self,
        _team_id: Uuid,
        _provider: ModelProvider,
        _encrypted: &EncryptedProviderApiKey,
    ) -> Result<ProviderApiKey> {
        Err(TeamProviderKeyError::Cipher)
    }
}

#[tokio::test]
async fn an_admin_registers_a_key_for_the_receipts_team_with_its_prefix() {
    let service = TeamProviderKeyService::new(FakeRepo::default(), FakeCipher::default());

    service
        .register(
            &receipt(TeamRole::Admin),
            ModelProvider::Anthropic,
            "sk-ant-api03-abc",
        )
        .await
        .expect("registered");

    assert_eq!(
        *service.repo.stored.lock().expect("lock"),
        vec![(
            TEAM.parse().expect("uuid"),
            ModelProvider::Anthropic,
            "sk-ant-".to_owned()
        )]
    );
}

#[tokio::test]
async fn a_malformed_key_never_reaches_kms_or_the_table() {
    let service = TeamProviderKeyService::new(FakeRepo::default(), FakeCipher::default());

    let error = service
        .register(
            &receipt(TeamRole::Owner),
            ModelProvider::OpenAi,
            "sk-ant-api03-abc",
        )
        .await
        .expect_err("an Anthropic key is not an OpenAI key");

    assert!(matches!(error, TeamProviderKeyError::MalformedKey));
    assert_eq!(*service.cipher.encrypted.lock().expect("lock"), 0);
    assert!(service.repo.stored.lock().expect("lock").is_empty());
}

#[test]
fn a_member_cannot_hold_the_receipt_registering_needs() {
    let member_as_admin = EntityAccessReceipt::<AdminTeamRole>::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: TEAM.to_owned(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Member,
        },
    );
    assert!(member_as_admin.is_err());
}

#[tokio::test]
async fn a_receipt_for_anything_but_a_team_is_refused() {
    let service = TeamProviderKeyService::new(FakeRepo::default(), FakeCipher::default());
    let document = EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: TEAM.to_owned(),
            entity_type: EntityType::Document,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Member,
        },
    )
    .expect("the role satisfies the requirement");

    assert!(matches!(
        service.list(&document).await,
        Err(TeamProviderKeyError::Forbidden)
    ));
}
