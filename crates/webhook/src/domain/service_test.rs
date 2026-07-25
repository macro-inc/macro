use super::{
    models::{
        CreateWebhookRequest, PatchWebhookRequest, ValidateWebhookResponse, Webhook,
        WebhookEndpointSchemePolicy, WebhookFilter, WebhookFilters, WebhookScope, WebhookStatus,
        WebhookValidationResult,
    },
    ports::{WebhookError, WebhookRepo, WebhookService, WebhookValidationClient},
    service::WebhookServiceImpl,
};
use chrono::Utc;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker, NoopMacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex as StdMutex},
};
use tokio::sync::Mutex;

#[derive(Debug, Default)]
struct RepoState {
    team_workspace_id: Option<String>,
    webhook: Option<Webhook>,
    validation_updates: Vec<bool>,
    create_fails: bool,
    patch_fails: bool,
    patch_returns_missing: bool,
    delete_fails: bool,
    delete_returns_missing: bool,
    validity_update_fails: bool,
    validity_update_returns_missing: bool,
    team_lookup_fails: bool,
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

    async fn failing_create() -> Self {
        let repo = Self::default();
        repo.state.lock().await.create_fails = true;
        repo
    }

    async fn failing_team_lookup() -> Self {
        let repo = Self::default();
        repo.state.lock().await.team_lookup_fails = true;
        repo
    }
}

fn filter_matches_event(filter: &WebhookFilter, event: &str, entity_id: &str) -> bool {
    if !filter.events.iter().any(|candidate| candidate == event) {
        return false;
    }

    match &filter.ids {
        Some(ids) => ids.iter().any(|id| id == entity_id),
        None => true,
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
        if self.state.lock().await.create_fails {
            anyhow::bail!("create failed");
        }

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

    async fn list_active_webhooks_matching_event(
        &self,
        workspace_ids: Vec<String>,
        event: String,
        entity_id: String,
    ) -> Result<Vec<Webhook>, Self::Err> {
        let Some(webhook) = self.state.lock().await.webhook.clone() else {
            return Ok(Vec::new());
        };

        if webhook.deleted_at.is_some()
            || webhook.status != WebhookStatus::Active
            || !webhook.is_valid
            || !workspace_ids.contains(&webhook.workspace_id)
        {
            return Ok(Vec::new());
        }

        if webhook
            .filters
            .iter()
            .any(|filter| filter_matches_event(filter, &event, &entity_id))
        {
            return Ok(vec![webhook]);
        }

        Ok(Vec::new())
    }

    async fn patch_webhook(
        &self,
        webhook_id: String,
        request: PatchWebhookRequest,
    ) -> Result<Option<Webhook>, Self::Err> {
        let mut state = self.state.lock().await;
        if state.patch_fails {
            anyhow::bail!("patch failed");
        }
        if state.patch_returns_missing {
            return Ok(None);
        }

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
        webhook.updated_at += chrono::Duration::seconds(1);
        Ok(Some(webhook.clone()))
    }

    async fn delete_webhook(&self, webhook_id: String) -> Result<Option<Webhook>, Self::Err> {
        let mut state = self.state.lock().await;
        if state.delete_fails {
            anyhow::bail!("delete failed");
        }
        if state.delete_returns_missing {
            return Ok(None);
        }

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
        if state.validity_update_fails {
            anyhow::bail!("validity update failed");
        }

        state.validation_updates.push(is_valid);
        if state.validity_update_returns_missing {
            return Ok(None);
        }

        let Some(webhook) = state
            .webhook
            .as_mut()
            .filter(|webhook| webhook.id == webhook_id)
        else {
            return Ok(None);
        };
        webhook.is_valid = is_valid;
        webhook.updated_at += chrono::Duration::seconds(1);
        Ok(Some(webhook.clone()))
    }

    async fn get_user_team_workspace_id(
        &self,
        _user_id: MacroUserIdStr<'static>,
    ) -> Result<Option<String>, Self::Err> {
        let state = self.state.lock().await;
        if state.team_lookup_fails {
            anyhow::bail!("team lookup failed");
        }
        Ok(state.team_workspace_id.clone())
    }
}

#[derive(Clone, Debug)]
struct PublishedEvent {
    topic: &'static str,
    key: String,
    payload: serde_json::Value,
}

#[derive(Clone, Default)]
struct TestEventBroker {
    published: Arc<StdMutex<Vec<PublishedEvent>>>,
    fail: bool,
}

impl TestEventBroker {
    fn failing() -> Self {
        Self {
            fail: true,
            ..Self::default()
        }
    }

    fn published(&self) -> Arc<StdMutex<Vec<PublishedEvent>>> {
        Arc::clone(&self.published)
    }
}

impl MacroEventBroker for TestEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        if self.fail {
            return Err(EventBrokerError::Publish("test failure".to_string()));
        }

        self.published.lock().unwrap().push(PublishedEvent {
            topic: event.topic(),
            key: event.key().to_string(),
            payload: serde_json::to_value(event.event())?,
        });
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

#[derive(Clone)]
struct FakeValidationClient {
    result: WebhookValidationResult,
    calls: Arc<Mutex<usize>>,
    transport_fails: bool,
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

    fn transport_failure() -> Self {
        let mut client = Self::succeeds();
        client.transport_fails = true;
        client
    }

    fn new(result: WebhookValidationResult) -> Self {
        Self {
            result,
            calls: Arc::new(Mutex::new(0)),
            transport_fails: false,
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
        if self.transport_fails {
            anyhow::bail!("validation transport failed");
        }
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
async fn create_publishes_full_sanitized_snapshot() {
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(
        FakeRepo::default(),
        FakeValidationClient::default(),
        event_broker,
    );
    let mut request = create_request();
    request.headers = Some(BTreeMap::from([
        ("Z-Private".to_string(), "z-header-value".to_string()),
        ("A-Private".to_string(), "a-header-value".to_string()),
    ]));

    let webhook = service
        .create_webhook(caller(), request)
        .await
        .expect("webhook should be created");

    assert_eq!(webhook.id, "wh_test");
    assert!(!webhook.is_valid);

    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.webhooks");
    assert_eq!(event.key, webhook.id);
    assert_eq!(event.payload["schema_version"], 1);
    assert_eq!(event.payload["event_type"], "webhook.created");
    assert!(event.payload["event_id"].is_string());
    assert_eq!(
        event.payload["metadata"],
        json!({
            "webhook_id": webhook.id,
            "workspace_id": webhook.workspace_id,
            "created_by_user_id": caller().as_ref(),
            "name": webhook.name,
            "endpoint_url": webhook.endpoint_url,
            "status": webhook.status,
            "is_valid": false,
            "filters": webhook.filters,
            "header_names": ["A-Private", "Z-Private"],
            "created_at": webhook.created_at,
        })
    );

    let serialized = event.payload.to_string();
    assert!(!serialized.contains("signing_secret"));
    assert!(!serialized.contains("a-header-value"));
    assert!(!serialized.contains("z-header-value"));
}

#[tokio::test]
async fn create_request_validation_failure_publishes_nothing() {
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(
        FakeRepo::default(),
        FakeValidationClient::default(),
        event_broker,
    );
    let mut request = create_request();
    request.name = " ".to_string();

    assert_bad_request(service.create_webhook(caller(), request).await);
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn create_fails_bad_request_when_team_scope_user_has_no_team() {
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(
        FakeRepo::default(),
        FakeValidationClient::default(),
        event_broker,
    );
    let mut request = create_request();
    request.scope = WebhookScope::Team;

    let result = service.create_webhook(caller(), request).await;

    assert!(matches!(
        result,
        Err(WebhookError::BadRequest(message)) if message == "team scope requires the user to belong to a team"
    ));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn create_team_scope_repository_failure_publishes_nothing() {
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(
        FakeRepo::failing_team_lookup().await,
        FakeValidationClient::default(),
        event_broker,
    );
    let mut request = create_request();
    request.scope = WebhookScope::Team;

    let result = service.create_webhook(caller(), request).await;

    assert!(matches!(result, Err(WebhookError::Repo(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn create_repository_failure_publishes_nothing() {
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(
        FakeRepo::failing_create().await,
        FakeValidationClient::default(),
        event_broker,
    );

    let result = service.create_webhook(caller(), create_request()).await;

    assert!(matches!(result, Err(WebhookError::Repo(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn create_succeeds_when_event_scheduling_fails() {
    let service = WebhookServiceImpl::new(
        FakeRepo::default(),
        FakeValidationClient::default(),
        TestEventBroker::failing(),
    );

    let webhook = service
        .create_webhook(caller(), create_request())
        .await
        .expect("event scheduling must not fail webhook creation");

    assert_eq!(webhook.id, "wh_test");
    assert!(!webhook.is_valid);
}

#[tokio::test]
async fn patch_publishes_requested_fields_and_status_transition() {
    let webhook = existing_webhook();
    let unchanged_name = webhook.name.clone();
    let repo = FakeRepo::with_webhook(webhook, None).await;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default(), event_broker);
    let request = PatchWebhookRequest {
        name: Some(unchanged_name.clone()),
        endpoint_url: None,
        headers: None,
        filters: None,
        status: Some(WebhookStatus::Paused),
    };

    let patched = service
        .patch_webhook(caller(), "wh_test".to_string(), request)
        .await
        .expect("webhook should be patched");

    assert_eq!(patched.name, unchanged_name);
    assert_eq!(patched.status, WebhookStatus::Paused);

    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.webhooks");
    assert_eq!(event.key, patched.id);
    assert_eq!(event.payload["schema_version"], 1);
    assert_eq!(event.payload["event_type"], "webhook.updated");
    assert!(event.payload["event_id"].is_string());
    assert_eq!(
        event.payload["metadata"],
        json!({
            "webhook_id": patched.id,
            "workspace_id": patched.workspace_id,
            "actor_user_id": caller().as_ref(),
            "name": unchanged_name,
            "endpoint_url": null,
            "filters": null,
            "headers_updated": false,
            "status": "paused",
            "previous_status": "active",
            "is_valid": true,
            "updated_at": patched.updated_at,
        })
    );
}

#[tokio::test]
async fn patch_endpoint_and_headers_publish_final_validity_row_without_secrets() {
    let mut webhook = existing_webhook();
    webhook.signing_secret = "stored-signing-secret".to_string();
    let initial_updated_at = webhook.updated_at;
    let repo = FakeRepo::with_webhook(webhook, None).await;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service =
        WebhookServiceImpl::new(repo.clone(), FakeValidationClient::default(), event_broker);
    let replacement_filters = vec![WebhookFilter {
        events: vec!["webhook.updated".to_string()],
        ids: Some(vec!["wh_target".to_string()]),
    }];
    let request = PatchWebhookRequest {
        name: None,
        endpoint_url: Some("https://example.com/replacement".to_string()),
        headers: Some(BTreeMap::from([(
            "X-Private".to_string(),
            "replacement-header-value".to_string(),
        )])),
        filters: Some(replacement_filters.clone()),
        status: None,
    };

    let patched = service
        .patch_webhook(caller(), "wh_test".to_string(), request)
        .await
        .expect("webhook should be patched and invalidated");

    assert!(!patched.is_valid);
    assert_eq!(
        patched.updated_at,
        initial_updated_at + chrono::Duration::seconds(2)
    );
    assert_eq!(repo.state.lock().await.validation_updates, vec![false]);

    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.webhooks");
    assert_eq!(event.key, patched.id);
    assert_eq!(event.payload["event_type"], "webhook.updated");
    assert_eq!(
        event.payload["metadata"],
        json!({
            "webhook_id": patched.id,
            "workspace_id": patched.workspace_id,
            "actor_user_id": caller().as_ref(),
            "name": null,
            "endpoint_url": "https://example.com/replacement",
            "filters": replacement_filters,
            "headers_updated": true,
            "status": null,
            "previous_status": null,
            "is_valid": false,
            "updated_at": patched.updated_at,
        })
    );

    let serialized = event.payload.to_string();
    assert!(!serialized.contains("signing_secret"));
    assert!(!serialized.contains("stored-signing-secret"));
    assert!(!serialized.contains("replacement-header-value"));
}

#[tokio::test]
async fn patch_fails_not_found_for_missing_id_without_publishing() {
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(
        FakeRepo::default(),
        FakeValidationClient::default(),
        event_broker,
    );

    let result = service
        .patch_webhook(caller(), "wh_missing".to_string(), patch_request())
        .await;

    assert!(matches!(result, Err(WebhookError::NotFound(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn patch_fails_unauthorized_without_publishing() {
    let mut webhook = existing_webhook();
    webhook.workspace_id = "other_workspace".to_string();
    let repo = FakeRepo::with_webhook(webhook, None).await;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default(), event_broker);

    let result = service
        .patch_webhook(caller(), "wh_test".to_string(), patch_request())
        .await;

    assert!(matches!(result, Err(WebhookError::Unauthorized)));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn patch_missing_row_after_authorization_publishes_nothing() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    repo.state.lock().await.patch_returns_missing = true;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default(), event_broker);

    let result = service
        .patch_webhook(caller(), "wh_test".to_string(), patch_request())
        .await;

    assert!(matches!(result, Err(WebhookError::NotFound(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn patch_repository_failure_publishes_nothing() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    repo.state.lock().await.patch_fails = true;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default(), event_broker);

    let result = service
        .patch_webhook(caller(), "wh_test".to_string(), patch_request())
        .await;

    assert!(matches!(result, Err(WebhookError::Repo(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn patch_validity_reset_failure_publishes_nothing() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    repo.state.lock().await.validity_update_fails = true;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default(), event_broker);
    let mut request = patch_request();
    request.endpoint_url = Some("https://example.com/replacement".to_string());

    let result = service
        .patch_webhook(caller(), "wh_test".to_string(), request)
        .await;

    assert!(matches!(result, Err(WebhookError::Repo(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn patch_missing_validity_reset_row_publishes_nothing() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    repo.state.lock().await.validity_update_returns_missing = true;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default(), event_broker);
    let mut request = patch_request();
    request.headers = Some(BTreeMap::new());

    let result = service
        .patch_webhook(caller(), "wh_test".to_string(), request)
        .await;

    assert!(matches!(result, Err(WebhookError::NotFound(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn patch_request_validation_failure_publishes_nothing() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default(), event_broker);
    let mut request = patch_request();
    request.endpoint_url = Some("http://example.com/replacement".to_string());

    assert_bad_request(
        service
            .patch_webhook(caller(), "wh_test".to_string(), request)
            .await,
    );
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn patch_succeeds_when_event_scheduling_fails() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    let service = WebhookServiceImpl::new(
        repo,
        FakeValidationClient::default(),
        TestEventBroker::failing(),
    );

    let patched = service
        .patch_webhook(caller(), "wh_test".to_string(), patch_request())
        .await
        .expect("event scheduling must not fail webhook patching");

    assert_eq!(patched.name, "Updated");
}

#[tokio::test]
async fn invalid_http_endpoint_is_rejected() {
    let repo = FakeRepo::default();
    let service =
        WebhookServiceImpl::new(repo, FakeValidationClient::default(), NoopMacroEventBroker);
    let mut request = create_request();
    request.endpoint_url = "http://example.com/webhook".to_string();

    assert_bad_request(service.create_webhook(caller(), request).await);
}

#[tokio::test]
async fn local_addresses_are_allowed_when_policy_permits_them() {
    let service = WebhookServiceImpl::new_with_endpoint_scheme_policy(
        FakeRepo::default(),
        FakeValidationClient::default(),
        WebhookEndpointSchemePolicy::HttpAndHttps,
        NoopMacroEventBroker,
    );

    for endpoint_url in [
        "http://localhost/webhook",
        "http://127.0.0.1/webhook",
        "http://10.1.2.3/webhook",
        "http://[::1]/webhook",
        "http://[fe80::1]/webhook",
    ] {
        let mut request = create_request();
        request.endpoint_url = endpoint_url.to_string();

        let webhook = service
            .create_webhook(caller(), request)
            .await
            .expect("local address should be allowed");

        assert_eq!(webhook.endpoint_url, endpoint_url);
    }
}

#[tokio::test]
async fn private_and_link_local_endpoints_are_rejected() {
    let repo = FakeRepo::default();
    let service =
        WebhookServiceImpl::new(repo, FakeValidationClient::default(), NoopMacroEventBroker);

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
    let service =
        WebhookServiceImpl::new(repo, FakeValidationClient::default(), NoopMacroEventBroker);
    let mut request = create_request();
    request.filters = Vec::new();

    assert_bad_request(service.create_webhook(caller(), request).await);
}

#[tokio::test]
async fn filter_with_empty_events_is_rejected() {
    let repo = FakeRepo::default();
    let service =
        WebhookServiceImpl::new(repo, FakeValidationClient::default(), NoopMacroEventBroker);
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
    let service =
        WebhookServiceImpl::new(repo, FakeValidationClient::default(), NoopMacroEventBroker);
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
    let service =
        WebhookServiceImpl::new(repo, FakeValidationClient::default(), NoopMacroEventBroker);

    let webhook = service
        .create_webhook(caller(), create_request())
        .await
        .unwrap();

    assert_eq!(webhook.filters, valid_filters());
}

#[tokio::test]
async fn filter_with_valid_ids_is_accepted() {
    let repo = FakeRepo::default();
    let service =
        WebhookServiceImpl::new(repo, FakeValidationClient::default(), NoopMacroEventBroker);
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
async fn validate_publishes_success_when_persisted_validity_is_unchanged() {
    let mut webhook = existing_webhook();
    webhook.workspace_id = "team_workspace".to_string();
    let repo = FakeRepo::with_webhook(webhook, Some("team_workspace".to_string())).await;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service =
        WebhookServiceImpl::new(repo.clone(), FakeValidationClient::succeeds(), event_broker);

    let response = service
        .validate_webhook(caller(), "wh_test".to_string())
        .await
        .expect("webhook validation should succeed");

    assert!(response.is_valid);
    assert_eq!(response.response_status, Some(204));
    assert_eq!(repo.state.lock().await.validation_updates, vec![true]);

    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.webhooks");
    assert_eq!(event.key, "wh_test");
    assert_eq!(event.payload["schema_version"], 1);
    assert_eq!(event.payload["event_type"], "webhook.validated");
    assert!(event.payload["event_id"].is_string());
    assert_eq!(
        event.payload["metadata"],
        json!({
            "webhook_id": "wh_test",
            "workspace_id": "team_workspace",
            "actor_user_id": caller().as_ref(),
            "is_valid": true,
            "response_status": 204,
            "message": null,
        })
    );
}

#[tokio::test]
async fn validate_http_failure_publishes_sanitized_invalid_result() {
    let mut webhook = existing_webhook();
    webhook.signing_secret = "stored-signing-secret".to_string();
    webhook.headers =
        BTreeMap::from([("X-Private".to_string(), "stored-header-value".to_string())]);
    let repo = FakeRepo::with_webhook(webhook, None).await;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service =
        WebhookServiceImpl::new(repo.clone(), FakeValidationClient::fails(), event_broker);

    let ValidateWebhookResponse {
        is_valid,
        response_status,
        message,
        ..
    } = service
        .validate_webhook(caller(), "wh_test".to_string())
        .await
        .expect("an HTTP failure is a completed validation");

    assert!(!is_valid);
    assert_eq!(response_status, Some(500));
    assert_eq!(message.as_deref(), Some("webhook returned HTTP 500"));
    assert_eq!(repo.state.lock().await.validation_updates, vec![false]);

    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.webhooks");
    assert_eq!(event.key, "wh_test");
    assert_eq!(event.payload["event_type"], "webhook.validated");
    assert_eq!(
        event.payload["metadata"],
        json!({
            "webhook_id": "wh_test",
            "workspace_id": caller().as_ref(),
            "actor_user_id": caller().as_ref(),
            "is_valid": false,
            "response_status": 500,
            "message": "webhook returned HTTP 500",
        })
    );
    let serialized = event.payload.to_string();
    assert!(!serialized.contains("signing_secret"));
    assert!(!serialized.contains("stored-signing-secret"));
    assert!(!serialized.contains("stored-header-value"));
}

#[tokio::test]
async fn validate_missing_webhook_publishes_nothing() {
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let validation_client = FakeValidationClient::succeeds();
    let service =
        WebhookServiceImpl::new(FakeRepo::default(), validation_client.clone(), event_broker);

    let result = service
        .validate_webhook(caller(), "wh_missing".to_string())
        .await;

    assert!(matches!(result, Err(WebhookError::NotFound(_))));
    assert_eq!(validation_client.call_count().await, 0);
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn validate_fails_unauthorized_before_calling_validation_client() {
    let mut webhook = existing_webhook();
    webhook.workspace_id = "other_workspace".to_string();
    let repo = FakeRepo::with_webhook(webhook, None).await;
    let validation_client = FakeValidationClient::succeeds();
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, validation_client.clone(), event_broker);

    let result = service
        .validate_webhook(caller(), "wh_test".to_string())
        .await;

    assert!(matches!(result, Err(WebhookError::Unauthorized)));
    assert_eq!(validation_client.call_count().await, 0);
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn validate_transport_failure_publishes_nothing() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(
        repo.clone(),
        FakeValidationClient::transport_failure(),
        event_broker,
    );

    let result = service
        .validate_webhook(caller(), "wh_test".to_string())
        .await;

    assert!(matches!(result, Err(WebhookError::Repo(_))));
    assert!(repo.state.lock().await.validation_updates.is_empty());
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn validate_validity_persistence_failure_publishes_nothing() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    repo.state.lock().await.validity_update_fails = true;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::succeeds(), event_broker);

    let result = service
        .validate_webhook(caller(), "wh_test".to_string())
        .await;

    assert!(matches!(result, Err(WebhookError::Repo(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn validate_missing_validity_row_publishes_nothing() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    repo.state.lock().await.validity_update_returns_missing = true;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::succeeds(), event_broker);

    let result = service
        .validate_webhook(caller(), "wh_test".to_string())
        .await;

    assert!(matches!(result, Err(WebhookError::NotFound(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn validate_succeeds_when_event_scheduling_fails() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    let service = WebhookServiceImpl::new(
        repo,
        FakeValidationClient::fails(),
        TestEventBroker::failing(),
    );

    let response = service
        .validate_webhook(caller(), "wh_test".to_string())
        .await
        .expect("event scheduling must not fail webhook validation");

    assert!(!response.is_valid);
    assert_eq!(response.response_status, Some(500));
}

#[tokio::test]
async fn delete_publishes_event_after_soft_deletion() {
    let mut webhook = existing_webhook();
    webhook.workspace_id = "team_workspace".to_string();
    let repo = FakeRepo::with_webhook(webhook, Some("team_workspace".to_string())).await;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service =
        WebhookServiceImpl::new(repo.clone(), FakeValidationClient::default(), event_broker);

    service
        .delete_webhook(caller(), "wh_test".to_string())
        .await
        .expect("webhook should be deleted");

    assert!(
        repo.state
            .lock()
            .await
            .webhook
            .as_ref()
            .is_some_and(|webhook| webhook.deleted_at.is_some())
    );
    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.webhooks");
    assert_eq!(event.key, "wh_test");
    assert_eq!(event.payload["schema_version"], 1);
    assert_eq!(event.payload["event_type"], "webhook.deleted");
    assert!(event.payload["event_id"].is_string());
    assert_eq!(
        event.payload["metadata"],
        json!({
            "webhook_id": "wh_test",
            "workspace_id": "team_workspace",
            "actor_user_id": caller().as_ref(),
        })
    );
}

#[tokio::test]
async fn delete_missing_webhook_publishes_nothing() {
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(
        FakeRepo::default(),
        FakeValidationClient::default(),
        event_broker,
    );

    let result = service
        .delete_webhook(caller(), "wh_missing".to_string())
        .await;

    assert!(matches!(result, Err(WebhookError::NotFound(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delete_unauthorized_webhook_publishes_nothing() {
    let mut webhook = existing_webhook();
    webhook.workspace_id = "other_workspace".to_string();
    let repo = FakeRepo::with_webhook(webhook, None).await;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default(), event_broker);

    let result = service
        .delete_webhook(caller(), "wh_test".to_string())
        .await;

    assert!(matches!(result, Err(WebhookError::Unauthorized)));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delete_repository_failure_publishes_nothing() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    repo.state.lock().await.delete_fails = true;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default(), event_broker);

    let result = service
        .delete_webhook(caller(), "wh_test".to_string())
        .await;

    assert!(matches!(result, Err(WebhookError::Repo(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delete_missing_row_after_authorization_publishes_nothing() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    repo.state.lock().await.delete_returns_missing = true;
    let event_broker = TestEventBroker::default();
    let published = event_broker.published();
    let service = WebhookServiceImpl::new(repo, FakeValidationClient::default(), event_broker);

    let result = service
        .delete_webhook(caller(), "wh_test".to_string())
        .await;

    assert!(matches!(result, Err(WebhookError::NotFound(_))));
    assert!(published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delete_succeeds_when_event_scheduling_fails() {
    let repo = FakeRepo::with_webhook(existing_webhook(), None).await;
    let service = WebhookServiceImpl::new(
        repo,
        FakeValidationClient::default(),
        TestEventBroker::failing(),
    );

    service
        .delete_webhook(caller(), "wh_test".to_string())
        .await
        .expect("event scheduling must not fail webhook deletion");
}
