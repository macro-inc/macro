//! Unit tests for the EntityAccessService.

use super::*;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Mock repository for testing.
#[derive(Clone)]
struct MockRepo {
    document_access: Arc<Mutex<Option<AccessLevel>>>,
    chat_access: Arc<Mutex<Option<AccessLevel>>>,
    project_access: Arc<Mutex<Option<AccessLevel>>>,
    thread_access: Arc<Mutex<Option<AccessLevel>>>,
    channel_membership: Arc<Mutex<Vec<Uuid>>>,
}

impl MockRepo {
    fn new() -> Self {
        Self {
            document_access: Arc::new(Mutex::new(None)),
            chat_access: Arc::new(Mutex::new(None)),
            project_access: Arc::new(Mutex::new(None)),
            thread_access: Arc::new(Mutex::new(None)),
            channel_membership: Arc::new(Mutex::new(vec![])),
        }
    }

    fn with_document_access(mut self, level: AccessLevel) -> Self {
        self.document_access = Arc::new(Mutex::new(Some(level)));
        self
    }

    fn with_chat_access(mut self, level: AccessLevel) -> Self {
        self.chat_access = Arc::new(Mutex::new(Some(level)));
        self
    }

    fn with_project_access(mut self, level: AccessLevel) -> Self {
        self.project_access = Arc::new(Mutex::new(Some(level)));
        self
    }

    fn with_thread_access(mut self, level: AccessLevel) -> Self {
        self.thread_access = Arc::new(Mutex::new(Some(level)));
        self
    }

    fn with_channel_membership(mut self, channels: Vec<Uuid>) -> Self {
        self.channel_membership = Arc::new(Mutex::new(channels));
        self
    }
}

impl AccessRepository for MockRepo {
    async fn get_document_access(
        &self,
        _document_id: &str,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(*self.document_access.lock().await)
    }

    async fn get_chat_access(
        &self,
        _chat_id: &str,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(*self.chat_access.lock().await)
    }

    async fn get_project_access(
        &self,
        _project_id: &str,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(*self.project_access.lock().await)
    }

    async fn get_thread_access(
        &self,
        _thread_id: &str,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(*self.thread_access.lock().await)
    }

    async fn check_user_channel_membership(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _channel_ids: &[Uuid],
    ) -> Result<Vec<Uuid>, AccessError> {
        Ok(self.channel_membership.lock().await.clone())
    }
}

fn test_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|test@test.com".to_string()).unwrap()
}

#[tokio::test]
async fn test_get_document_access_returns_level_from_repo() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Edit);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(&user_id, "doc-1", EntityType::Document)
        .await;

    assert_eq!(result.unwrap(), Some(AccessLevel::Edit));
}

#[tokio::test]
async fn test_get_chat_access_returns_level_from_repo() {
    let repo = MockRepo::new().with_chat_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(&user_id, "chat-1", EntityType::Chat)
        .await;

    assert_eq!(result.unwrap(), Some(AccessLevel::View));
}

#[tokio::test]
async fn test_get_project_access_returns_level_from_repo() {
    let repo = MockRepo::new().with_project_access(AccessLevel::Owner);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(&user_id, "proj-1", EntityType::Project)
        .await;

    assert_eq!(result.unwrap(), Some(AccessLevel::Owner));
}

#[tokio::test]
async fn test_get_thread_access_returns_level_from_repo() {
    let repo = MockRepo::new().with_thread_access(AccessLevel::Comment);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(&user_id, "thread-1", EntityType::EmailThread)
        .await;

    assert_eq!(result.unwrap(), Some(AccessLevel::Comment));
}

#[tokio::test]
async fn test_get_channel_access_for_member_returns_view() {
    let channel_uuid: Uuid = "11111111-1111-1111-1111-111111111111".parse().unwrap();
    let repo = MockRepo::new().with_channel_membership(vec![channel_uuid]);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(
            &user_id,
            "11111111-1111-1111-1111-111111111111",
            EntityType::Channel,
        )
        .await;

    assert_eq!(result.unwrap(), Some(AccessLevel::View));
}

#[tokio::test]
async fn test_get_channel_access_for_non_member_returns_none() {
    let repo = MockRepo::new().with_channel_membership(vec![]);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(
            &user_id,
            "11111111-1111-1111-1111-111111111111",
            EntityType::Channel,
        )
        .await;

    assert_eq!(result.unwrap(), None);
}

#[tokio::test]
async fn test_get_channel_access_with_invalid_uuid_returns_error() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(&user_id, "not-a-uuid", EntityType::Channel)
        .await;

    assert!(matches!(result, Err(AccessError::BadRequest(_))));
}

#[tokio::test]
async fn test_check_access_sufficient_level_returns_actual_level() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Edit);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .check_access(&user_id, "doc-1", EntityType::Document, AccessLevel::View)
        .await;

    assert_eq!(result.unwrap(), AccessLevel::Edit);
}

#[tokio::test]
async fn test_check_access_insufficient_level_returns_unauthorized() {
    let repo = MockRepo::new().with_document_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .check_access(&user_id, "doc-1", EntityType::Document, AccessLevel::Edit)
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_check_access_no_access_returns_unauthorized() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .check_access(&user_id, "doc-1", EntityType::Document, AccessLevel::View)
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_unsupported_entity_type_returns_none() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    // Email, Team, and User entity types don't have access checks implemented
    let result = service
        .get_access_level(&user_id, "email-1", EntityType::Email)
        .await;
    assert_eq!(result.unwrap(), None);

    let result = service
        .get_access_level(&user_id, "team-1", EntityType::Team)
        .await;
    assert_eq!(result.unwrap(), None);

    let result = service
        .get_access_level(&user_id, "user-1", EntityType::User)
        .await;
    assert_eq!(result.unwrap(), None);
}
