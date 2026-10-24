use std::sync::Mutex;

use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::models::{AgentKeyStatus, AgentOwner, EncryptedProviderApiKey};

const BOT: &str = "00000000-0000-0000-0000-0000000000b0";

fn agent(harness: &str, model: &str) -> KeyedAgent {
    KeyedAgent {
        bot_id: BOT.parse().expect("uuid"),
        owner: AgentOwner::User(
            MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).expect("user id"),
        ),
        harness: harness.to_owned(),
        model: model.to_owned(),
    }
}

fn encrypted() -> EncryptedProviderApiKey {
    EncryptedProviderApiKey {
        key_ciphertext: vec![1],
        encryption_version: 1,
        kms_key_id: "kms".to_owned(),
    }
}

/// One agent's key, and the agent as it is configured now.
#[derive(Default)]
struct FakeRepo {
    stored: Mutex<Option<(ModelProvider, String)>>,
    agent: Mutex<Option<KeyedAgent>>,
}

#[async_trait::async_trait]
impl AgentKeyRepo for FakeRepo {
    async fn upsert(
        &self,
        _bot_id: Uuid,
        provider: ModelProvider,
        _encrypted: &EncryptedProviderApiKey,
        key_prefix: &str,
    ) -> Result<AgentKeyStatus> {
        *self.stored.lock().expect("lock") = Some((provider, key_prefix.to_owned()));
        Ok(AgentKeyStatus {
            provider,
            updated_at: chrono::Utc::now(),
        })
    }

    async fn status(&self, _bot_id: Uuid) -> Result<Option<AgentKeyStatus>> {
        Ok(self
            .stored
            .lock()
            .expect("lock")
            .as_ref()
            .map(|(provider, _)| AgentKeyStatus {
                provider: *provider,
                updated_at: chrono::Utc::now(),
            }))
    }

    async fn delete(&self, _bot_id: Uuid) -> Result<bool> {
        Ok(self.stored.lock().expect("lock").take().is_some())
    }

    async fn stored(&self, _bot_id: Uuid) -> Result<Option<StoredAgentKey>> {
        let stored = self.stored.lock().expect("lock").clone();
        let agent = self.agent.lock().expect("lock").clone();
        Ok(stored
            .zip(agent)
            .map(|((provider, _), agent)| StoredAgentKey {
                agent,
                provider,
                encrypted: encrypted(),
            }))
    }
}

#[derive(Default)]
struct FakeCipher {
    encrypted: Mutex<usize>,
}

#[async_trait::async_trait]
impl AgentKeyCipher for FakeCipher {
    async fn encrypt(
        &self,
        _bot_id: Uuid,
        _key: &ProviderApiKey,
    ) -> Result<EncryptedProviderApiKey> {
        *self.encrypted.lock().expect("lock") += 1;
        Ok(encrypted())
    }

    async fn decrypt(
        &self,
        _bot_id: Uuid,
        provider: ModelProvider,
        _encrypted: &EncryptedProviderApiKey,
    ) -> Result<ProviderApiKey> {
        let plaintext = match provider {
            ModelProvider::Anthropic => "sk-ant-api03-abc",
            ModelProvider::OpenAi => "sk-proj-abc",
        };
        ProviderApiKey::parse(provider, plaintext).map_err(|_| AgentKeyError::Cipher)
    }
}

/// A plan that includes agent keys, or one that does not.
struct Paid(Mutex<bool>);

#[async_trait::async_trait]
impl KeyPlans for Paid {
    async fn allows_keys(&self, _owner: &AgentOwner) -> Result<bool> {
        Ok(*self.0.lock().expect("lock"))
    }
}

fn service(paid: bool) -> AgentKeyService<FakeRepo, FakeCipher, Paid> {
    AgentKeyService::new(
        FakeRepo::default(),
        FakeCipher::default(),
        Paid(Mutex::new(paid)),
    )
}

#[tokio::test]
async fn an_in_memory_agent_stores_a_key_for_its_models_provider() {
    let service = service(true);
    let agent = agent("in-memory", "anthropic/claude-sonnet-5-5");

    let view = service
        .set(&agent, "sk-ant-api03-abc")
        .await
        .expect("saved");

    assert_eq!(
        view.key.map(|key| key.provider),
        Some(ModelProvider::Anthropic)
    );
    assert!(view.plan_allows);
    assert_eq!(
        *service.repo.stored.lock().expect("lock"),
        Some((ModelProvider::Anthropic, "sk-ant-".to_owned()))
    );
}

#[tokio::test]
async fn only_in_memory_agents_on_anthropic_or_openai_models_take_a_key() {
    for (harness, model) in [
        ("cursor", "anthropic/claude-sonnet-5-5"),
        ("in-memory", "google/gemini-3.8-flash"),
    ] {
        let service = service(true);
        let error = service
            .set(&agent(harness, model), "sk-ant-api03-abc")
            .await
            .expect_err("unsupported");
        assert!(
            matches!(error, AgentKeyError::UnsupportedAgent),
            "{harness} {model}"
        );
        assert_eq!(*service.cipher.encrypted.lock().expect("lock"), 0);
    }
}

#[tokio::test]
async fn a_key_for_another_provider_or_a_free_plan_never_reaches_kms() {
    let service = service(true);
    let error = service
        .set(
            &agent("in-memory", "openai/gpt-6-astra"),
            "sk-ant-api03-abc",
        )
        .await
        .expect_err("an Anthropic key is not an OpenAI key");
    assert!(matches!(error, AgentKeyError::MalformedKey));

    let free = self::service(false);
    let error = free
        .set(&agent("in-memory", "openai/gpt-6-astra"), "sk-proj-abc")
        .await
        .expect_err("free plans have no keys");
    assert!(matches!(error, AgentKeyError::PlanRequired));

    assert_eq!(*service.cipher.encrypted.lock().expect("lock"), 0);
    assert_eq!(*free.cipher.encrypted.lock().expect("lock"), 0);
}

#[tokio::test]
async fn turns_run_on_the_key_only_while_the_agent_and_plan_still_fit_it() {
    let service = service(true);
    let bot: Uuid = BOT.parse().expect("uuid");
    let keyed = agent("in-memory", "anthropic/claude-sonnet-5-5");
    service
        .set(&keyed, "sk-ant-api03-abc")
        .await
        .expect("saved");

    *service.repo.agent.lock().expect("lock") = Some(keyed);
    let key = service
        .usable_key(bot)
        .await
        .expect("read")
        .expect("usable");
    assert_eq!(key.key.expose(), "sk-ant-api03-abc");

    *service.repo.agent.lock().expect("lock") = Some(agent("in-memory", "openai/gpt-6-astra"));
    assert_eq!(
        service.usable_provider(bot).await.expect("read"),
        None,
        "an agent moved to another provider's model runs on Macro usage"
    );

    *service.repo.agent.lock().expect("lock") =
        Some(agent("in-memory", "anthropic/claude-sonnet-5-5"));
    *service.plans.0.lock().expect("lock") = false;
    assert!(
        service.usable_key(bot).await.expect("read").is_none(),
        "a downgraded owner keeps the key but turns do not run on it"
    );
    assert!(
        service
            .view(&agent("in-memory", "anthropic/claude-sonnet-5-5"))
            .await
            .expect("view")
            .key
            .is_some(),
        "the key is still shown, so it can be removed"
    );
}
