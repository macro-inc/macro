use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{TimeZone, Utc};
use entity_access::domain::models::EntityType;
use macro_user_id::cowlike::CowLike;

use super::*;
use crate::domain::models::{EncryptedSecret, StoredSecret};

const TEAM: &str = "0190f1b4-6c2e-7b7a-9a4c-1d2e3f405060";
const OTHER_TEAM: &str = "0190f1b4-6c2e-7b7a-9a4c-1d2e3f405061";
const AGENT: &str = "macro|sam@example.com";
const HUMAN: &str = "macro|ann@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id)
        .expect("valid user id")
        .into_owned()
}

#[derive(Default)]
struct FakeRepository {
    rows: Mutex<HashMap<(String, String), EncryptedSecret>>,
}

impl AgentSecretRepository for FakeRepository {
    async fn upsert(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
        encrypted: &EncryptedSecret,
    ) -> Result<AgentSecretSummary, AgentSecretError> {
        self.rows.lock().expect("lock").insert(
            (agent_user_id.as_ref().to_string(), name.as_str().to_string()),
            encrypted.clone(),
        );

        Ok(AgentSecretSummary {
            name: name.as_str().to_string(),
            created_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
            updated_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
        })
    }

    async fn get(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
    ) -> Result<Option<StoredSecret>, AgentSecretError> {
        Ok(self
            .rows
            .lock()
            .expect("lock")
            .get(&(agent_user_id.as_ref().to_string(), name.as_str().to_string()))
            .map(|encrypted| StoredSecret {
                name: name.as_str().to_string(),
                encrypted: encrypted.clone(),
                created_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
                updated_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
            }))
    }

    async fn list(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<AgentSecretSummary>, AgentSecretError> {
        let mut names: Vec<String> = self
            .rows
            .lock()
            .expect("lock")
            .keys()
            .filter(|(agent, _)| agent == agent_user_id.as_ref())
            .map(|(_, name)| name.clone())
            .collect();
        names.sort();

        Ok(names
            .into_iter()
            .map(|name| AgentSecretSummary {
                name,
                created_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
                updated_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
            })
            .collect())
    }

    async fn delete(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
    ) -> Result<bool, AgentSecretError> {
        Ok(self
            .rows
            .lock()
            .expect("lock")
            .remove(&(agent_user_id.as_ref().to_string(), name.as_str().to_string()))
            .is_some())
    }
}

/// "Encrypts" by prefixing the bound identity, and refuses any other.
struct FakeCipher;

impl SecretCipher for FakeCipher {
    async fn encrypt(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
        value: &SecretValue,
    ) -> Result<EncryptedSecret, AgentSecretError> {
        Ok(EncryptedSecret {
            ciphertext: format!("{agent_user_id}/{}:{}", name.as_str(), value.expose()).into_bytes(),
            encryption_version: 1,
            kms_key_id: "key".to_string(),
        })
    }

    async fn decrypt(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &SecretName,
        encrypted: &EncryptedSecret,
    ) -> Result<SecretValue, AgentSecretError> {
        let ciphertext = String::from_utf8(encrypted.ciphertext.clone()).expect("utf8");
        let prefix = format!("{agent_user_id}/{}:", name.as_str());
        let value = ciphertext
            .strip_prefix(&prefix)
            .ok_or(AgentSecretError::NotFound)?;
        SecretValue::parse(value.to_string())
    }
}

struct FakeDirectory;

impl TeamAgentDirectory for FakeDirectory {
    async fn team_of(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<Uuid>, AgentSecretError> {
        Ok((agent_user_id.as_ref() == AGENT).then(|| Uuid::parse_str(TEAM).expect("uuid")))
    }
}

fn service() -> AgentSecretServiceImpl<FakeRepository, FakeCipher, FakeDirectory> {
    AgentSecretServiceImpl::new(FakeRepository::default(), FakeCipher, FakeDirectory)
}

fn admin_of(team: &str) -> EntityAccessReceipt<AdminTeamRole> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(user(HUMAN), team, EntityType::Team)
}

#[tokio::test]
async fn an_agent_stores_reads_and_deletes_its_own_secret() {
    let service = service();

    let summary = service
        .put(&user(AGENT), "github-token", "ghp_abc".to_string())
        .await
        .expect("stored");
    assert_eq!(summary.name, "github-token");

    let secret = service
        .get(&user(AGENT), "github-token")
        .await
        .expect("read");
    assert_eq!(secret.name, "github-token");
    assert_eq!(secret.value, "ghp_abc");

    service
        .delete(&user(AGENT), "github-token")
        .await
        .expect("deleted");
    assert!(matches!(
        service.get(&user(AGENT), "github-token").await,
        Err(AgentSecretError::NotFound)
    ));
    service
        .delete(&user(AGENT), "github-token")
        .await
        .expect("deleting a missing secret succeeds");
}

#[tokio::test]
async fn only_team_agents_keep_secrets() {
    let service = service();

    assert!(matches!(
        service
            .put(&user(HUMAN), "github-token", "ghp_abc".to_string())
            .await,
        Err(AgentSecretError::NotAnAgent)
    ));
    assert!(matches!(
        service.get(&user(HUMAN), "github-token").await,
        Err(AgentSecretError::NotAnAgent)
    ));
}

#[tokio::test]
async fn malformed_names_and_values_are_refused() {
    let service = service();

    assert!(matches!(
        service
            .put(&user(AGENT), "GitHub Token", "ghp_abc".to_string())
            .await,
        Err(AgentSecretError::BadRequest(_))
    ));
    assert!(matches!(
        service
            .put(&user(AGENT), "github-token", String::new())
            .await,
        Err(AgentSecretError::BadRequest(_))
    ));
    assert!(matches!(
        service
            .put(&user(AGENT), "github-token", "x".repeat(4097))
            .await,
        Err(AgentSecretError::BadRequest(_))
    ));
}

#[tokio::test]
async fn an_admin_lists_and_deletes_secrets_only_on_their_team() {
    let service = service();
    service
        .put(&user(AGENT), "linear-token", "lin_abc".to_string())
        .await
        .expect("stored");
    service
        .put(&user(AGENT), "github-token", "ghp_abc".to_string())
        .await
        .expect("stored");

    let listed = service
        .list_for_admin(admin_of(TEAM), &user(AGENT))
        .await
        .expect("listed");
    assert_eq!(
        listed
            .secrets
            .iter()
            .map(|secret| secret.name.as_str())
            .collect::<Vec<_>>(),
        vec!["github-token", "linear-token"]
    );

    assert!(matches!(
        service
            .list_for_admin(admin_of(OTHER_TEAM), &user(AGENT))
            .await,
        Err(AgentSecretError::NotFound)
    ));
    assert!(matches!(
        service
            .delete_for_admin(admin_of(OTHER_TEAM), &user(AGENT), "github-token")
            .await,
        Err(AgentSecretError::NotFound)
    ));

    service
        .delete_for_admin(admin_of(TEAM), &user(AGENT), "github-token")
        .await
        .expect("deleted");
    assert!(matches!(
        service.get(&user(AGENT), "github-token").await,
        Err(AgentSecretError::NotFound)
    ));
}
