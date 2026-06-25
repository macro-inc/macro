//! Unit tests for [`WebhookServiceImpl`] using in-memory port fakes — no
//! database, HTTP, or real crypto. They focus on the service's own logic:
//! validation ordering, the resource-access gate, and create/patch wiring.

use std::sync::{Arc, Mutex};

use chrono::Utc;
use entity_access::domain::models::{
    AccessError, AccessLevel, CallChannelInfo, EntityAccessReceipt, EntityPermission, EntityType,
    RequiredPermission, UserTeamInfo,
};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use serde_json::json;
use uuid::Uuid;

use crate::domain::ids::WebhookId;
use crate::domain::model::{
    CreateWebhookRequest, PatchWebhookRequest, RuleInput, Webhook, WebhookActor, WebhookRule,
    WebhookStatus,
};
use crate::domain::ports::{
    EndpointValidationError, EndpointValidator, NewRuleRecord, NewWebhookRecord, SecretEncryptor,
    WebhookFieldsPatch, WebhookRepoError, WebhookRepository,
};
use crate::domain::rule::{Condition, FilterGroup, FilterNode, FilterOperator};
use crate::domain::service::{
    CreateWebhookError, PatchWebhookError, WebhookDraft, WebhookService, WebhookServiceImpl,
};

// --- Fake repository -------------------------------------------------------

#[derive(Clone, Default)]
struct FakeRepo {
    stored: Arc<Mutex<Option<Webhook>>>,
}

fn record_to_webhook(record: &NewWebhookRecord) -> Webhook {
    let now = Utc::now();
    Webhook {
        id: record.id.clone(),
        workspace_id: record.workspace_id.clone(),
        owner_user_id: record
            .owner_user_id
            .clone()
            .map(|id| MacroUserIdStr::try_from(id).unwrap()),
        name: record.name.clone(),
        endpoint_url: record.endpoint_url.clone(),
        status: WebhookStatus::Enabled,
        paused_at: None,
        pause_reason: None,
        last_success_at: None,
        last_failure_at: None,
        created_by_user_id: MacroUserIdStr::try_from(record.created_by_user_id.clone()).unwrap(),
        created_at: now,
        updated_at: now,
        rule: Some(WebhookRule {
            id: record.rule.id.clone(),
            webhook_id: record.id.clone(),
            workspace_id: record.rule.workspace_id.clone(),
            name: record.rule.name.clone(),
            enabled: record.rule.enabled,
            definition: record.rule.definition.clone(),
            created_at: now,
            updated_at: now,
        }),
    }
}

impl WebhookRepository for FakeRepo {
    async fn create_webhook_with_rule(
        &self,
        record: NewWebhookRecord,
    ) -> Result<Webhook, WebhookRepoError> {
        let webhook = record_to_webhook(&record);
        *self.stored.lock().unwrap() = Some(webhook.clone());
        Ok(webhook)
    }

    async fn get_webhook(
        &self,
        workspace_id: &str,
        webhook_id: &WebhookId,
    ) -> Result<Option<Webhook>, WebhookRepoError> {
        Ok(self
            .stored
            .lock()
            .unwrap()
            .clone()
            .filter(|webhook| webhook.workspace_id == workspace_id && &webhook.id == webhook_id))
    }

    async fn update_webhook(
        &self,
        webhook_id: &WebhookId,
        patch: WebhookFieldsPatch,
    ) -> Result<Webhook, WebhookRepoError> {
        let mut guard = self.stored.lock().unwrap();
        let webhook = guard.as_mut().ok_or(WebhookRepoError::NotFound)?;
        if &webhook.id != webhook_id {
            return Err(WebhookRepoError::NotFound);
        }
        if let Some(name) = patch.name {
            webhook.name = name;
        }
        if let Some(url) = patch.endpoint_url {
            webhook.endpoint_url = url;
        }
        if let Some(status) = patch.status {
            webhook.status = status;
        }
        Ok(webhook.clone())
    }

    async fn replace_rule(
        &self,
        webhook_id: &WebhookId,
        record: NewRuleRecord,
    ) -> Result<Webhook, WebhookRepoError> {
        let mut guard = self.stored.lock().unwrap();
        let webhook = guard.as_mut().ok_or(WebhookRepoError::NotFound)?;
        if &webhook.id != webhook_id {
            return Err(WebhookRepoError::NotFound);
        }
        let now = Utc::now();
        webhook.rule = Some(WebhookRule {
            id: record.id,
            webhook_id: webhook_id.clone(),
            workspace_id: record.workspace_id,
            name: record.name,
            enabled: record.enabled,
            definition: record.definition,
            created_at: now,
            updated_at: now,
        });
        Ok(webhook.clone())
    }
}

// --- Fake entity-access service -------------------------------------------

#[derive(Clone, Default)]
struct FakeAccess {
    /// (entity_type, id) pairs the user is allowed to see.
    allowed: Arc<Vec<(EntityType, String)>>,
}

impl FakeAccess {
    fn allowing(pairs: &[(EntityType, &str)]) -> Self {
        Self {
            allowed: Arc::new(pairs.iter().map(|(ty, id)| (*ty, id.to_string())).collect()),
        }
    }
}

impl EntityAccessService for FakeAccess {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let allowed = self
            .allowed
            .iter()
            .any(|(ty, id)| *ty == entity_type && id == entity_id);
        Ok(allowed.then_some(AccessLevel::View))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Internal)
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid), AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Err(AccessError::Internal)
    }
}

// --- Fake endpoint validator + secret encryptor ----------------------------

#[derive(Clone, Default)]
struct FakeValidator {
    reject: bool,
}

impl EndpointValidator for FakeValidator {
    async fn validate(&self, _url: &str) -> Result<(), EndpointValidationError> {
        if self.reject {
            Err(EndpointValidationError::NotHttps)
        } else {
            Ok(())
        }
    }
}

const TEST_SECRET: &str = "whsec_test_secret";

#[derive(Clone, Default)]
struct FakeEncryptor;

impl SecretEncryptor for FakeEncryptor {
    fn generate_secret(&self) -> String {
        TEST_SECRET.to_string()
    }

    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, crate::domain::ports::EncryptionError> {
        // Identity "encryption" so tests can assert round-trips without crypto.
        Ok(plaintext.to_vec())
    }

    fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>, crate::domain::ports::EncryptionError> {
        Ok(ciphertext.to_vec())
    }
}

// --- Builders --------------------------------------------------------------

type Service = WebhookServiceImpl<FakeRepo, FakeAccess, FakeValidator, FakeEncryptor>;

fn service(access: FakeAccess, validator: FakeValidator) -> (Service, FakeRepo) {
    let repo = FakeRepo::default();
    let service = WebhookServiceImpl::new(repo.clone(), access, validator, FakeEncryptor);
    (service, repo)
}

fn actor() -> WebhookActor {
    WebhookActor {
        user_id: MacroUserIdStr::try_from_email("creator@example.com").unwrap(),
        workspace_id: "wrk_test".to_string(),
        org_id: Some(1),
    }
}

fn channel_in_filter(channel_ids: &[&str]) -> FilterGroup {
    FilterGroup::All(vec![FilterNode::Condition(Condition {
        field: "data.channel_id".to_string(),
        op: FilterOperator::In,
        value: Some(json!(channel_ids)),
    })])
}

fn create_req(channel_ids: &[&str]) -> CreateWebhookRequest {
    CreateWebhookRequest {
        name: "My hook".to_string(),
        endpoint_url: "https://example.com/hook".to_string(),
        headers: None,
        rule: RuleInput {
            name: Some("rule".to_string()),
            enabled: Some(true),
            version: Some(1),
            events: vec!["channel.message.created".to_string()],
            filters: Some(channel_in_filter(channel_ids)),
        },
    }
}

// --- Tests -----------------------------------------------------------------

#[tokio::test]
async fn create_succeeds_and_returns_secret_once_when_user_has_access() {
    let (service, repo) = service(
        FakeAccess::allowing(&[(EntityType::Channel, "ch_1")]),
        FakeValidator::default(),
    );

    let response = service
        .create_webhook(&actor(), create_req(&["ch_1"]))
        .await
        .expect("create should succeed");

    assert_eq!(response.signing_secret, TEST_SECRET);
    assert_eq!(response.webhook.name, "My hook");
    assert!(response.webhook.rule.is_some());
    // Persisted.
    assert!(repo.stored.lock().unwrap().is_some());
}

#[tokio::test]
async fn create_rejected_when_user_lacks_access_to_a_filtered_channel() {
    let (service, repo) = service(FakeAccess::default(), FakeValidator::default());

    let err = service
        .create_webhook(&actor(), create_req(&["ch_secret"]))
        .await
        .expect_err("create should be rejected");

    assert!(
        matches!(
            err,
            CreateWebhookError::Validation(
                crate::domain::service::ValidateWebhookError::ResourceForbidden { .. }
            )
        ),
        "unexpected error: {err:?}"
    );
    // Nothing persisted on validation failure.
    assert!(repo.stored.lock().unwrap().is_none());
}

#[tokio::test]
async fn create_checks_every_referenced_channel() {
    // User can see ch_1 but not ch_2; a rule referencing both must be rejected.
    let (service, _repo) = service(
        FakeAccess::allowing(&[(EntityType::Channel, "ch_1")]),
        FakeValidator::default(),
    );

    let err = service
        .create_webhook(&actor(), create_req(&["ch_1", "ch_2"]))
        .await
        .expect_err("partial access should be rejected");

    assert!(matches!(
        err,
        CreateWebhookError::Validation(
            crate::domain::service::ValidateWebhookError::ResourceForbidden { .. }
        )
    ));
}

#[tokio::test]
async fn create_rejected_for_invalid_endpoint() {
    let (service, _repo) = service(
        FakeAccess::allowing(&[(EntityType::Channel, "ch_1")]),
        FakeValidator { reject: true },
    );

    let err = service
        .create_webhook(&actor(), create_req(&["ch_1"]))
        .await
        .expect_err("invalid endpoint should be rejected");

    assert!(matches!(
        err,
        CreateWebhookError::Validation(
            crate::domain::service::ValidateWebhookError::InvalidEndpoint(_)
        )
    ));
}

#[tokio::test]
async fn create_rejected_for_reserved_header() {
    let (service, _repo) = service(
        FakeAccess::allowing(&[(EntityType::Channel, "ch_1")]),
        FakeValidator::default(),
    );

    let mut req = create_req(&["ch_1"]);
    let mut headers = std::collections::BTreeMap::new();
    headers.insert("X-Macro-Signature".to_string(), "nope".to_string());
    req.headers = Some(headers);

    let err = service
        .create_webhook(&actor(), req)
        .await
        .expect_err("reserved header should be rejected");

    assert!(matches!(err, CreateWebhookError::BadRequest(_)));
}

#[tokio::test]
async fn create_rejected_for_unknown_event() {
    let (service, _repo) = service(FakeAccess::default(), FakeValidator::default());

    let mut req = create_req(&["ch_1"]);
    req.rule.events = vec!["channel.message.exploded".to_string()];
    req.rule.filters = None;

    let err = service
        .create_webhook(&actor(), req)
        .await
        .expect_err("unknown event should be rejected");

    assert!(matches!(
        err,
        CreateWebhookError::Validation(crate::domain::service::ValidateWebhookError::InvalidRule(
            _
        ))
    ));
}

#[tokio::test]
async fn validate_webhook_passes_for_filterless_rule_without_touching_access() {
    // No filters -> no resource refs -> access service never consulted.
    let (service, _repo) = service(FakeAccess::default(), FakeValidator::default());

    let draft = WebhookDraft {
        endpoint_url: "https://example.com/hook".to_string(),
        rule: crate::domain::rule::RuleDefinition::from_parts(
            Some(1),
            vec!["channel.message.created".to_string()],
            None,
        ),
    };

    service
        .validate_webhook(&actor(), &draft)
        .await
        .expect("filterless rule should validate");
}

#[tokio::test]
async fn patch_unknown_webhook_is_not_found() {
    let (service, _repo) = service(FakeAccess::default(), FakeValidator::default());

    let err = service
        .patch_webhook(
            &actor(),
            &WebhookId::generate(),
            PatchWebhookRequest::default(),
        )
        .await
        .expect_err("patching a missing webhook should be NotFound");

    assert!(matches!(err, PatchWebhookError::NotFound));
}

#[tokio::test]
async fn patch_replaces_rule_when_user_has_access() {
    let (service, _repo) = service(
        FakeAccess::allowing(&[(EntityType::Channel, "ch_1"), (EntityType::Channel, "ch_2")]),
        FakeValidator::default(),
    );

    let created = service
        .create_webhook(&actor(), create_req(&["ch_1"]))
        .await
        .unwrap()
        .webhook;

    let patch = PatchWebhookRequest {
        rule: Some(RuleInput {
            name: Some("updated".to_string()),
            enabled: Some(true),
            version: Some(1),
            events: vec!["channel.message.created".to_string()],
            filters: Some(channel_in_filter(&["ch_2"])),
        }),
        ..Default::default()
    };

    let updated = service
        .patch_webhook(&actor(), &created.id, patch)
        .await
        .expect("patch should succeed");

    let rule = updated.rule.expect("rule present");
    assert_eq!(rule.name.as_deref(), Some("updated"));
    // The rule id is reused (one rule per webhook, updated in place).
    assert_eq!(rule.id, created.rule.unwrap().id);
}

#[tokio::test]
async fn patch_rejects_rule_referencing_inaccessible_resource() {
    let (service, _repo) = service(
        FakeAccess::allowing(&[(EntityType::Channel, "ch_1")]),
        FakeValidator::default(),
    );

    let created = service
        .create_webhook(&actor(), create_req(&["ch_1"]))
        .await
        .unwrap()
        .webhook;

    let patch = PatchWebhookRequest {
        rule: Some(RuleInput {
            name: None,
            enabled: Some(true),
            version: Some(1),
            events: vec!["channel.message.created".to_string()],
            filters: Some(channel_in_filter(&["ch_forbidden"])),
        }),
        ..Default::default()
    };

    let err = service
        .patch_webhook(&actor(), &created.id, patch)
        .await
        .expect_err("patch with inaccessible resource should be rejected");

    assert!(matches!(
        err,
        PatchWebhookError::Validation(
            crate::domain::service::ValidateWebhookError::ResourceForbidden { .. }
        )
    ));
}
