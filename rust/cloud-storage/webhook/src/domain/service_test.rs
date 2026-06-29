use super::{
    models::{
        CreateWebhookRequest, PatchWebhookRequest, ValidateWebhookResponse, Webhook, WebhookRule,
        WebhookStatus, WebhookValidationResult,
    },
    ports::{WebhookError, WebhookRepo, WebhookService, WebhookValidationClient},
    service::WebhookServiceImpl,
};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use std::{collections::BTreeMap, sync::Arc};
use tokio::sync::Mutex;

#[derive(Debug, Default)]
struct RepoState {
    can_edit: bool,
    webhook: Option<Webhook>,
    validation_updates: Vec<bool>,
}

#[derive(Clone, Default)]
struct FakeRepo {
    state: Arc<Mutex<RepoState>>,
}

impl FakeRepo {
    async fn with_webhook(webhook: Webhook, can_edit: bool) -> Self {
        let repo = Self::default();
        let mut state = repo.state.lock().await;
        state.webhook = Some(webhook);
        state.can_edit = can_edit;
        drop(state);
        repo
    }
}

impl WebhookRepo for FakeRepo {
    type Err = anyhow::Error;

    async fn create_webhook(
        &self,
        created_by_user_id: MacroUserIdStr<'static>,
        request: CreateWebhookRequest,
        _secret_encrypted: String,
        _headers_encrypted: serde_json::Value,
    ) -> Result<Webhook, Self::Err> {
        let webhook = webhook_from_create(created_by_user_id, request);
        self.state.lock().await.webhook = Some(webhook.clone());
        Ok(webhook)
    }

    async fn get_webhook(&self, webhook_id: String) -> Result<Option<Webhook>, Self::Err> {
        Ok(self
            .state
            .lock()
            .await
            .webhook
            .clone()
            .filter(|webhook| webhook.id == webhook_id))
    }

    async fn patch_webhook(
        &self,
        webhook_id: String,
        request: PatchWebhookRequest,
    ) -> Result<Option<Webhook>, Self::Err> {
        let mut state = self.state.lock().await;
        let Some(webhook) = state
            .webhook
            .as_mut()
            .filter(|webhook| webhook.id == webhook_id)
        else {
            return Ok(None);
        };
        if let Some(name) = request.name {
            webhook.name = name;
        }
        if let Some(endpoint_url) = request.endpoint_url {
            webhook.endpoint_url = endpoint_url;
        }
        if let Some(headers) = request.headers {
            webhook.headers = headers;
        }
        if let Some(rule) = request.rule {
            webhook.rule.rule = rule;
        }
        if let Some(status) = request.status {
            webhook.status = status;
        }
        Ok(Some(webhook.clone()))
    }

    async fn set_webhook_validity(
        &self,
        webhook_id: String,
        is_valid: bool,
    ) -> Result<Option<Webhook>, Self::Err> {
        let mut state = self.state.lock().await;
        state.validation_updates.push(is_valid);
        let Some(webhook) = state
            .webhook
            .as_mut()
            .filter(|webhook| webhook.id == webhook_id)
        else {
            return Ok(None);
        };
        webhook.is_valid = is_valid;
        Ok(Some(webhook.clone()))
    }

    async fn user_can_edit_workspace(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _workspace_id: String,
    ) -> Result<bool, Self::Err> {
        Ok(self.state.lock().await.can_edit)
    }
}

#[derive(Clone)]
struct FakeValidationClient {
    result: WebhookValidationResult,
    calls: Arc<Mutex<usize>>,
}

impl FakeValidationClient {
    fn succeeds() -> Self {
        Self::new(WebhookValidationResult {
            is_valid: true,
            response_status: Some(204),
            message: None,
        })
    }

    fn fails() -> Self {
        Self::new(WebhookValidationResult {
            is_valid: false,
            response_status: Some(500),
            message: Some("webhook returned HTTP 500".to_string()),
        })
    }

    fn new(result: WebhookValidationResult) -> Self {
        Self {
            result,
            calls: Arc::new(Mutex::new(0)),
        }
    }

    async fn call_count(&self) -> usize {
        *self.calls.lock().await
    }
}

impl Default for FakeValidationClient {
    fn default() -> Self {
        Self::succeeds()
    }
}

impl WebhookValidationClient for FakeValidationClient {
    type Err = anyhow::Error;

    async fn validate_webhook(
        &self,
        _webhook: Webhook,
    ) -> Result<WebhookValidationResult, Self::Err> {
        *self.calls.lock().await += 1;
        Ok(self.result.clone())
    }
}

fn caller() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("user@example.com").unwrap()
}

fn valid_rule() -> serde_json::Value {
    serde_json::json!({ "version": "v1", "events": ["file.created"] })
}

fn create_request() -> CreateWebhookRequest {
    CreateWebhookRequest {
        workspace_id: "workspace_1".to_string(),
        name: "Files".to_string(),
        endpoint_url: "https://example.com/webhook".to_string(),
        headers: Some(BTreeMap::from([(
            "X-Custom".to_string(),
            "value".to_string(),
        )])),
        rule: valid_rule(),
    }
}

fn patch_request() -> PatchWebhookRequest {
    PatchWebhookRequest {
        name: Some("Updated".to_string()),
        endpoint_url: None,
        headers: None,
        rule: None,
        status: None,
    }
}

fn webhook_from_create(
    created_by_user_id: MacroUserIdStr<'static>,
    request: CreateWebhookRequest,
) -> Webhook {
    let now = Utc::now();
    Webhook {
        id: "wh_test".to_string(),
        workspace_id: request.workspace_id.clone(),
        name: request.name,
        endpoint_url: request.endpoint_url,
        headers: request.headers.unwrap_or_default(),
        status: WebhookStatus::Active,
        is_valid: true,
        created_by_user_id: created_by_user_id.as_ref().to_string(),
        created_at: now,
        updated_at: now,
        deleted_at: None,
        rule: WebhookRule {
            id: "whr_test".to_string(),
            webhook_id: "wh_test".to_string(),
            workspace_id: request.workspace_id,
            rule: request.rule,
            status: WebhookStatus::Active,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        },
    }
}

fn existing_webhook() -> Webhook {
    webhook_from_create(caller(), create_request())
}

fn assert_bad_request<T>(result: Result<T, WebhookError>) {
    assert!(matches!(result, Err(WebhookError::BadRequest(_))));
}

#[tokio::test]
async fn create_succeeds_when_caller_can_edit_workspace() {
    let repo = FakeRepo::default();
    repo.state.lock().await.can_edit = true;
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());

    let webhook = service
        .create_webhook(caller(), create_request())
        .await
        .unwrap();

    assert_eq!(webhook.id, "wh_test");
    assert!(!webhook.is_valid);
}

#[tokio::test]
async fn create_fails_unauthorized_when_caller_cannot_edit_workspace() {
    let service = WebhookServiceImpl::new(FakeRepo::default(), FakeValidationClient::default());

    let result = service.create_webhook(caller(), create_request()).await;

    assert!(matches!(result, Err(WebhookError::Unauthorized)));
}

#[tokio::test]
async fn patch_fails_not_found_for_missing_id() {
    let repo = FakeRepo::default();
    repo.state.lock().await.can_edit = true;
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());

    let result = service
        .patch_webhook(caller(), "wh_missing".to_string(), patch_request())
        .await;

    assert!(matches!(result, Err(WebhookError::NotFound(_))));
}

#[tokio::test]
async fn patch_fails_unauthorized_when_caller_cannot_edit_workspace() {
    let repo = FakeRepo::with_webhook(existing_webhook(), false).await;
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());

    let result = service
        .patch_webhook(caller(), "wh_test".to_string(), patch_request())
        .await;

    assert!(matches!(result, Err(WebhookError::Unauthorized)));
}

#[tokio::test]
async fn invalid_http_endpoint_is_rejected() {
    let repo = FakeRepo::default();
    repo.state.lock().await.can_edit = true;
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());
    let mut request = create_request();
    request.endpoint_url = "http://example.com/webhook".to_string();

    assert_bad_request(service.create_webhook(caller(), request).await);
}

#[tokio::test]
async fn empty_events_array_is_rejected() {
    let repo = FakeRepo::default();
    repo.state.lock().await.can_edit = true;
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());
    let mut request = create_request();
    request.rule = serde_json::json!({ "version": "v1", "events": [] });

    assert_bad_request(service.create_webhook(caller(), request).await);
}

#[tokio::test]
async fn validate_succeeds_and_sets_webhook_validity() {
    let repo = FakeRepo::with_webhook(existing_webhook(), true).await;
    let service = WebhookServiceImpl::new(repo.clone(), FakeValidationClient::succeeds());

    let response = service
        .validate_webhook(caller(), "wh_test".to_string())
        .await
        .unwrap();

    assert!(response.is_valid);
    assert_eq!(response.response_status, Some(204));
    assert_eq!(repo.state.lock().await.validation_updates, vec![true]);
}

#[tokio::test]
async fn validate_fails_unauthorized_before_calling_validation_client() {
    let repo = FakeRepo::with_webhook(existing_webhook(), false).await;
    let validation_client = FakeValidationClient::succeeds();
    let service = WebhookServiceImpl::new(repo, validation_client.clone());

    let result = service
        .validate_webhook(caller(), "wh_test".to_string())
        .await;

    assert!(matches!(result, Err(WebhookError::Unauthorized)));
    assert_eq!(validation_client.call_count().await, 0);
}

#[tokio::test]
async fn validate_records_invalid_and_returns_sanitized_failure() {
    let repo = FakeRepo::with_webhook(existing_webhook(), true).await;
    let service = WebhookServiceImpl::new(repo.clone(), FakeValidationClient::fails());

    let ValidateWebhookResponse {
        is_valid,
        response_status,
        message,
        ..
    } = service
        .validate_webhook(caller(), "wh_test".to_string())
        .await
        .unwrap();

    assert!(!is_valid);
    assert_eq!(response_status, Some(500));
    assert_eq!(message.as_deref(), Some("webhook returned HTTP 500"));
    assert_eq!(repo.state.lock().await.validation_updates, vec![false]);
}
