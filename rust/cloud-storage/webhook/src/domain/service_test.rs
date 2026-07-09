use super::{
    models::{
        CreateWebhookRequest, PatchWebhookRequest, ValidateWebhookResponse, Webhook, WebhookFilter,
        WebhookFilters, WebhookScope, WebhookStatus, WebhookValidationResult,
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
    team_workspace_id: Option<String>,
    webhook: Option<Webhook>,
    validation_updates: Vec<bool>,
}

#[derive(Clone, Default)]
struct FakeRepo {
    state: Arc<Mutex<RepoState>>,
}

impl FakeRepo {
    async fn with_webhook(webhook: Webhook, team_workspace_id: Option<String>) -> Self {
        let repo = Self::default();
        let mut state = repo.state.lock().await;
        state.webhook = Some(webhook);
        state.team_workspace_id = team_workspace_id;
        drop(state);
        repo
    }
}

impl WebhookRepo for FakeRepo {
    type Err = anyhow::Error;

    async fn create_webhook(
        &self,
        created_by_user_id: MacroUserIdStr<'static>,
        workspace_id: String,
        request: CreateWebhookRequest,
        _signing_secret: String,
        _headers: serde_json::Value,
    ) -> Result<Webhook, Self::Err> {
        let webhook = webhook_from_create(created_by_user_id, workspace_id, request);
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
        if let Some(filters) = request.filters {
            webhook.filters = filters;
        }
        if let Some(status) = request.status {
            webhook.status = status;
        }
        Ok(Some(webhook.clone()))
    }

    async fn delete_webhook(&self, webhook_id: String) -> Result<Option<Webhook>, Self::Err> {
        let mut state = self.state.lock().await;
        let webhook = state
            .webhook
            .as_mut()
            .filter(|webhook| webhook.id == webhook_id)
            .map(|webhook| {
                webhook.deleted_at = Some(Utc::now());
                webhook.clone()
            });
        Ok(webhook)
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

    async fn get_user_team_workspace_id(
        &self,
        _user_id: MacroUserIdStr<'static>,
    ) -> Result<Option<String>, Self::Err> {
        Ok(self.state.lock().await.team_workspace_id.clone())
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

fn valid_filters() -> WebhookFilters {
    vec![WebhookFilter {
        events: vec!["file.created".to_string()],
        ids: None,
    }]
}

fn create_request() -> CreateWebhookRequest {
    CreateWebhookRequest {
        scope: WebhookScope::User,
        name: "Files".to_string(),
        endpoint_url: "https://example.com/webhook".to_string(),
        headers: Some(BTreeMap::from([(
            "X-Custom".to_string(),
            "value".to_string(),
        )])),
        filters: valid_filters(),
    }
}

fn patch_request() -> PatchWebhookRequest {
    PatchWebhookRequest {
        name: Some("Updated".to_string()),
        endpoint_url: None,
        headers: None,
        filters: None,
        status: None,
    }
}

fn webhook_from_create(
    created_by_user_id: MacroUserIdStr<'static>,
    workspace_id: String,
    request: CreateWebhookRequest,
) -> Webhook {
    let now = Utc::now();
    Webhook {
        id: "wh_test".to_string(),
        workspace_id,
        name: request.name,
        endpoint_url: request.endpoint_url,
        signing_secret: "secret".to_string(),
        headers: request.headers.unwrap_or_default(),
        status: WebhookStatus::Active,
        is_valid: true,
        created_by_user_id: created_by_user_id.as_ref().to_string(),
        created_at: now,
        updated_at: now,
        deleted_at: None,
        filters: request.filters,
    }
}

fn existing_webhook() -> Webhook {
    webhook_from_create(caller(), caller().as_ref().to_string(), create_request())
}

fn assert_bad_request<T>(result: Result<T, WebhookError>) {
    assert!(matches!(result, Err(WebhookError::BadRequest(_))));
}

#[tokio::test]
async fn create_succeeds_for_user_scope() {
    let repo = FakeRepo::default();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());

    let webhook = service
        .create_webhook(caller(), create_request())
        .await
        .unwrap();

    assert_eq!(webhook.id, "wh_test");
    assert!(!webhook.is_valid);
}

#[tokio::test]
async fn create_fails_bad_request_when_team_scope_user_has_no_team() {
    let service = WebhookServiceImpl::new(FakeRepo::default(), FakeValidationClient::default());
    let mut request = create_request();
    request.scope = WebhookScope::Team;

    let result = service.create_webhook(caller(), request).await;

    assert!(matches!(
        result,
        Err(WebhookError::BadRequest(message)) if message == "team scope requires the user to belong to a team"
    ));
}

#[tokio::test]
async fn patch_fails_not_found_for_missing_id() {
    let repo = FakeRepo::default();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());

    let result = service
        .patch_webhook(caller(), "wh_missing".to_string(), patch_request())
        .await;

    assert!(matches!(result, Err(WebhookError::NotFound(_))));
}

#[tokio::test]
async fn patch_fails_unauthorized_when_caller_does_not_own_workspace() {
    let mut webhook = existing_webhook();
    webhook.workspace_id = "other_workspace".to_string();
    let repo = FakeRepo::with_webhook(webhook, None).await;
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());

    let result = service
        .patch_webhook(caller(), "wh_test".to_string(), patch_request())
        .await;

    assert!(matches!(result, Err(WebhookError::Unauthorized)));
}

#[tokio::test]
async fn invalid_http_endpoint_is_rejected() {
    let repo = FakeRepo::default();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());
    let mut request = create_request();
    request.endpoint_url = "http://example.com/webhook".to_string();

    assert_bad_request(service.create_webhook(caller(), request).await);
}

#[tokio::test]
async fn private_and_link_local_endpoints_are_rejected() {
    let repo = FakeRepo::default();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());

    for endpoint_url in [
        "https://localhost/webhook",
        "https://10.1.2.3/webhook",
        "https://172.16.0.1/webhook",
        "https://192.168.1.1/webhook",
        "https://169.254.169.254/latest/meta-data",
        "https://[fe80::1]/webhook",
    ] {
        let mut request = create_request();
        request.endpoint_url = endpoint_url.to_string();

        assert_bad_request(service.create_webhook(caller(), request).await);
    }
}

#[tokio::test]
async fn empty_filters_list_is_rejected() {
    let repo = FakeRepo::default();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());
    let mut request = create_request();
    request.filters = Vec::new();

    assert_bad_request(service.create_webhook(caller(), request).await);
}

#[tokio::test]
async fn filter_with_empty_events_is_rejected() {
    let repo = FakeRepo::default();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());
    let mut request = create_request();
    request.filters = vec![WebhookFilter {
        events: Vec::new(),
        ids: None,
    }];

    assert_bad_request(service.create_webhook(caller(), request).await);
}

#[tokio::test]
async fn filter_with_empty_ids_is_rejected() {
    let repo = FakeRepo::default();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());
    let mut request = create_request();
    request.filters = vec![WebhookFilter {
        events: vec!["file.created".to_string()],
        ids: Some(Vec::new()),
    }];

    assert_bad_request(service.create_webhook(caller(), request).await);
}

#[tokio::test]
async fn filter_without_ids_is_accepted() {
    let repo = FakeRepo::default();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());

    let webhook = service
        .create_webhook(caller(), create_request())
        .await
        .unwrap();

    assert_eq!(webhook.filters, valid_filters());
}

#[tokio::test]
async fn filter_with_valid_ids_is_accepted() {
    let repo = FakeRepo::default();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default());
    let mut request = create_request();
    request.filters = vec![WebhookFilter {
        events: vec!["file.created".to_string()],
        ids: Some(vec!["file_1".to_string()]),
    }];
    let expected_filters = request.filters.clone();

    let webhook = service.create_webhook(caller(), request).await.unwrap();

    assert_eq!(webhook.filters, expected_filters);
}

#[tokio::test]
async fn validate_succeeds_and_sets_webhook_validity() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
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
    let mut webhook = existing_webhook();
    webhook.workspace_id = "other_workspace".to_string();
    let repo = FakeRepo::with_webhook(webhook, None).await;
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
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
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
