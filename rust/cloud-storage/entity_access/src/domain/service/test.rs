//! Unit tests for the EntityAccessService.

use super::*;
use crate::domain::models::{
    AdminParticipantRole, CommentAccessLevel, EditAccessLevel, EntityAccessAuth,
    MemberParticipantRole, OwnerParticipantRole, ParticipantRole, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::OwnerAccessLevel;
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
    channel_role: Arc<Mutex<ChannelRoleResult>>,
    document_users: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
    chat_users: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
    project_users: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
    thread_users: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
}

impl MockRepo {
    fn new() -> Self {
        Self {
            document_access: Arc::new(Mutex::new(None)),
            chat_access: Arc::new(Mutex::new(None)),
            project_access: Arc::new(Mutex::new(None)),
            thread_access: Arc::new(Mutex::new(None)),
            channel_membership: Arc::new(Mutex::new(vec![])),
            channel_role: Arc::new(Mutex::new(ChannelRoleResult::NotFound)),
            document_users: Arc::new(Mutex::new(vec![])),
            chat_users: Arc::new(Mutex::new(vec![])),
            project_users: Arc::new(Mutex::new(vec![])),
            thread_users: Arc::new(Mutex::new(vec![])),
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

    fn with_channel_role(mut self, result: ChannelRoleResult) -> Self {
        self.channel_role = Arc::new(Mutex::new(result));
        self
    }

    fn with_document_users(mut self, users: Vec<MacroUserIdStr<'static>>) -> Self {
        self.document_users = Arc::new(Mutex::new(users));
        self
    }

    fn with_chat_users(mut self, users: Vec<MacroUserIdStr<'static>>) -> Self {
        self.chat_users = Arc::new(Mutex::new(users));
        self
    }

    fn with_project_users(mut self, users: Vec<MacroUserIdStr<'static>>) -> Self {
        self.project_users = Arc::new(Mutex::new(users));
        self
    }

    fn with_thread_users(mut self, users: Vec<MacroUserIdStr<'static>>) -> Self {
        self.thread_users = Arc::new(Mutex::new(users));
        self
    }
}

impl AccessRepository for MockRepo {
    async fn get_document_access(
        &self,
        _document_id: &str,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(*self.document_access.lock().await)
    }

    async fn get_chat_access(
        &self,
        _chat_id: &str,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(*self.chat_access.lock().await)
    }

    async fn get_project_access(
        &self,
        _project_id: &str,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(*self.project_access.lock().await)
    }

    async fn get_thread_access(
        &self,
        _thread_id: &str,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(*self.thread_access.lock().await)
    }

    async fn check_user_channel_membership(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _channel_ids: &[Uuid],
    ) -> Result<Vec<Uuid>, AccessError> {
        Ok(self.channel_membership.lock().await.clone())
    }

    async fn get_channel_role(
        &self,
        _channel_id: &Uuid,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _user_org_id: Option<i64>,
    ) -> Result<ChannelRoleResult, AccessError> {
        Ok(*self.channel_role.lock().await)
    }

    async fn get_document_users(
        &self,
        _document_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(self.document_users.lock().await.clone())
    }

    async fn get_chat_users(
        &self,
        _chat_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(self.chat_users.lock().await.clone())
    }

    async fn get_project_users(
        &self,
        _project_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(self.project_users.lock().await.clone())
    }

    async fn get_thread_users(
        &self,
        _thread_id: &str,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(self.thread_users.lock().await.clone())
    }
}

fn test_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|test@test.com".to_string()).unwrap()
}

fn user_id(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}

#[tokio::test]
async fn test_get_document_access_returns_level_from_repo() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Edit);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(Some(&user_id), "doc-1", EntityType::Document)
        .await;

    assert_eq!(result.unwrap(), Some(AccessLevel::Edit));
}

#[tokio::test]
async fn test_get_chat_access_returns_level_from_repo() {
    let repo = MockRepo::new().with_chat_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(Some(&user_id), "chat-1", EntityType::Chat)
        .await;

    assert_eq!(result.unwrap(), Some(AccessLevel::View));
}

#[tokio::test]
async fn test_get_project_access_returns_level_from_repo() {
    let repo = MockRepo::new().with_project_access(AccessLevel::Owner);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(Some(&user_id), "proj-1", EntityType::Project)
        .await;

    assert_eq!(result.unwrap(), Some(AccessLevel::Owner));
}

#[tokio::test]
async fn test_get_thread_access_returns_level_from_repo() {
    let repo = MockRepo::new().with_thread_access(AccessLevel::Comment);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_access_level(Some(&user_id), "thread-1", EntityType::EmailThread)
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
            Some(&user_id),
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
            Some(&user_id),
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
        .get_access_level(Some(&user_id), "not-a-uuid", EntityType::Channel)
        .await;

    assert!(matches!(result, Err(AccessError::BadRequest(_))));
}

#[tokio::test]
async fn test_check_access_sufficient_level_returns_actual_level() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Edit);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .check_access(
            Some(&user_id),
            "doc-1",
            EntityType::Document,
            AccessLevel::View,
        )
        .await;

    assert_eq!(result.unwrap(), AccessLevel::Edit);
}

#[tokio::test]
async fn test_check_access_insufficient_level_returns_unauthorized() {
    let repo = MockRepo::new().with_document_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .check_access(
            Some(&user_id),
            "doc-1",
            EntityType::Document,
            AccessLevel::Edit,
        )
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_check_access_no_access_returns_unauthorized() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .check_access(
            Some(&user_id),
            "doc-1",
            EntityType::Document,
            AccessLevel::View,
        )
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_unsupported_entity_type_returns_none() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    // Team, and User entity types don't have access checks implemented
    let result = service
        .get_access_level(Some(&user_id), "team-1", EntityType::Team)
        .await;
    assert_eq!(result.unwrap(), None);

    let result = service
        .get_access_level(Some(&user_id), "user-1", EntityType::User)
        .await;
    assert_eq!(result.unwrap(), None);
}

// --- get_entity_permission tests ---

#[tokio::test]
async fn test_get_entity_permission_document_returns_access_level() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Edit);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_entity_permission(Some(&user_id), "doc-1", EntityType::Document, None)
        .await
        .unwrap();

    assert!(matches!(
        result,
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit
        }
    ));
}

#[tokio::test]
async fn test_get_entity_permission_document_no_access_returns_unauthorized() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_entity_permission(Some(&user_id), "doc-1", EntityType::Document, None)
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_get_entity_permission_channel_returns_role() {
    let repo = MockRepo::new().with_channel_role(ChannelRoleResult::Role(ParticipantRole::Admin));
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_entity_permission(
            Some(&user_id),
            "11111111-1111-1111-1111-111111111111",
            EntityType::Channel,
            None,
        )
        .await
        .unwrap();

    assert!(matches!(
        result,
        EntityPermission::ChannelRole {
            role: ParticipantRole::Admin
        }
    ));
}

#[tokio::test]
async fn test_get_entity_permission_channel_no_access_returns_unauthorized() {
    let repo = MockRepo::new().with_channel_role(ChannelRoleResult::NoAccess);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_entity_permission(
            Some(&user_id),
            "11111111-1111-1111-1111-111111111111",
            EntityType::Channel,
            None,
        )
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_get_entity_permission_channel_not_found_returns_not_found() {
    let repo = MockRepo::new().with_channel_role(ChannelRoleResult::NotFound);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_entity_permission(
            Some(&user_id),
            "11111111-1111-1111-1111-111111111111",
            EntityType::Channel,
            None,
        )
        .await;

    assert!(matches!(result, Err(AccessError::NotFound(_))));
}

#[tokio::test]
async fn test_get_entity_permission_invalid_channel_uuid_returns_bad_request() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_entity_permission(Some(&user_id), "not-a-uuid", EntityType::Channel, None)
        .await;

    assert!(matches!(result, Err(AccessError::BadRequest(_))));
}

#[tokio::test]
async fn test_get_entity_permission_unsupported_type_returns_bad_request() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .get_entity_permission(Some(&user_id), "team-1", EntityType::Team, None)
        .await;

    assert!(matches!(result, Err(AccessError::BadRequest(_))));
}

// --- Public (unauthenticated) access tests ---

#[tokio::test]
async fn test_public_access_with_sufficient_level_returns_level() {
    let repo = MockRepo::new().with_document_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .check_public_access("doc-1", EntityType::Document, AccessLevel::View)
        .await;

    assert_eq!(result.unwrap(), AccessLevel::View);
}

#[tokio::test]
async fn test_public_access_with_insufficient_level_returns_unauthorized() {
    let repo = MockRepo::new().with_document_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .check_public_access("doc-1", EntityType::Document, AccessLevel::Edit)
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_public_access_with_no_access_returns_unauthorized() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .check_public_access("doc-1", EntityType::Document, AccessLevel::View)
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_get_access_level_with_none_user_id() {
    let repo = MockRepo::new().with_document_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_access_level(None, "doc-1", EntityType::Document)
        .await;

    assert_eq!(result.unwrap(), Some(AccessLevel::View));
}

#[tokio::test]
async fn test_check_access_with_none_user_id_and_sufficient_level() {
    let repo = MockRepo::new().with_project_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .check_access(None, "proj-1", EntityType::Project, AccessLevel::View)
        .await;

    assert_eq!(result.unwrap(), AccessLevel::View);
}

#[tokio::test]
async fn test_check_access_with_none_user_id_and_no_access() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .check_access(None, "doc-1", EntityType::Document, AccessLevel::View)
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

// --- generate_entity_access_receipt tests ---

#[tokio::test]
async fn test_generate_receipt_document_with_access() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Edit);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let receipt = service
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await
        .unwrap();

    assert!(matches!(receipt.auth(), EntityAccessAuth::Authenticated(_)));
    assert_eq!(receipt.entity().entity_id, "doc-1");
    assert!(matches!(receipt.entity().entity_type, EntityType::Document));
    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit
        }
    ));
}

#[tokio::test]
async fn test_generate_receipt_document_no_access_returns_unauthorized() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

// --- minimum access level enforcement tests ---

#[tokio::test]
async fn test_generate_receipt_view_access_satisfies_view_requirement() {
    let repo = MockRepo::new().with_document_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let receipt = service
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await
        .unwrap();

    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View
        }
    ));
}

#[tokio::test]
async fn test_generate_receipt_edit_access_satisfies_view_requirement() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Edit);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let receipt = service
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await
        .unwrap();

    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit
        }
    ));
}

#[tokio::test]
async fn test_generate_receipt_owner_access_satisfies_owner_requirement() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Owner);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let receipt = service
        .generate_entity_access_receipt::<OwnerAccessLevel>(
            &user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await
        .unwrap();

    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    ));
}

#[tokio::test]
async fn test_generate_receipt_view_access_fails_comment_requirement() {
    let repo = MockRepo::new().with_document_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .generate_entity_access_receipt::<CommentAccessLevel>(
            &user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_generate_receipt_view_access_fails_edit_requirement() {
    let repo = MockRepo::new().with_document_access(AccessLevel::View);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .generate_entity_access_receipt::<EditAccessLevel>(
            &user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_generate_receipt_edit_access_fails_owner_requirement() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Edit);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .generate_entity_access_receipt::<OwnerAccessLevel>(
            &user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_generate_receipt_comment_access_fails_edit_requirement() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Comment);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .generate_entity_access_receipt::<EditAccessLevel>(
            &user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_generate_receipt_comment_access_satisfies_comment_requirement() {
    let repo = MockRepo::new().with_document_access(AccessLevel::Comment);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let receipt = service
        .generate_entity_access_receipt::<CommentAccessLevel>(
            &user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await
        .unwrap();

    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Comment
        }
    ));
}

#[tokio::test]
async fn test_generate_receipt_channel_with_role() {
    let repo = MockRepo::new().with_channel_role(ChannelRoleResult::Role(ParticipantRole::Admin));
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let receipt = service
        .generate_entity_access_receipt::<MemberParticipantRole>(
            &user_id,
            None,
            "11111111-1111-1111-1111-111111111111",
            EntityType::Channel,
        )
        .await
        .unwrap();

    assert!(matches!(receipt.auth(), EntityAccessAuth::Authenticated(_)));
    assert_eq!(
        receipt.entity().entity_id,
        "11111111-1111-1111-1111-111111111111"
    );
    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::ChannelRole {
            role: ParticipantRole::Admin
        }
    ));
}

#[tokio::test]
async fn test_generate_receipt_channel_member_fails_edit_requirement() {
    let repo = MockRepo::new().with_channel_role(ChannelRoleResult::Role(ParticipantRole::Member));
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .generate_entity_access_receipt::<AdminParticipantRole>(
            &user_id,
            None,
            "11111111-1111-1111-1111-111111111111",
            EntityType::Channel,
        )
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_generate_receipt_channel_admin_satisfies_edit_requirement() {
    let repo = MockRepo::new().with_channel_role(ChannelRoleResult::Role(ParticipantRole::Admin));
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let receipt = service
        .generate_entity_access_receipt::<AdminParticipantRole>(
            &user_id,
            None,
            "11111111-1111-1111-1111-111111111111",
            EntityType::Channel,
        )
        .await
        .unwrap();

    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::ChannelRole {
            role: ParticipantRole::Admin
        }
    ));
}

#[tokio::test]
async fn test_generate_receipt_channel_admin_fails_owner_requirement() {
    let repo = MockRepo::new().with_channel_role(ChannelRoleResult::Role(ParticipantRole::Admin));
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .generate_entity_access_receipt::<OwnerParticipantRole>(
            &user_id,
            None,
            "11111111-1111-1111-1111-111111111111",
            EntityType::Channel,
        )
        .await;

    assert!(matches!(result, Err(AccessError::Unauthorized)));
}

#[tokio::test]
async fn test_generate_receipt_channel_not_found_returns_not_found() {
    let repo = MockRepo::new().with_channel_role(ChannelRoleResult::NotFound);
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .generate_entity_access_receipt::<MemberParticipantRole>(
            &user_id,
            None,
            "11111111-1111-1111-1111-111111111111",
            EntityType::Channel,
        )
        .await;

    assert!(matches!(result, Err(AccessError::NotFound(_))));
}

#[tokio::test]
async fn test_generate_receipt_unsupported_type_returns_bad_request() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);
    let user_id = test_user_id();

    let result = service
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user_id,
            None,
            "team-1",
            EntityType::Team,
        )
        .await;

    assert!(matches!(result, Err(AccessError::BadRequest(_))));
}

// --- get_users_by_entity tests ---

#[tokio::test]
async fn test_get_users_by_entity_document_returns_users() {
    let users = vec![
        user_id("macro|alice@test.com"),
        user_id("macro|bob@test.com"),
    ];
    let repo = MockRepo::new().with_document_users(users.clone());
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("doc-1", EntityType::Document)
        .await
        .unwrap();

    assert_eq!(result.len(), 2);
    assert_eq!(result[0].to_string(), "macro|alice@test.com");
    assert_eq!(result[1].to_string(), "macro|bob@test.com");
}

#[tokio::test]
async fn test_get_users_by_entity_document_returns_empty_when_no_users() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("doc-1", EntityType::Document)
        .await
        .unwrap();

    assert!(result.is_empty());
}

#[tokio::test]
async fn test_get_users_by_entity_chat_returns_users() {
    let users = vec![user_id("macro|charlie@test.com")];
    let repo = MockRepo::new().with_chat_users(users.clone());
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("chat-1", EntityType::Chat)
        .await
        .unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].to_string(), "macro|charlie@test.com");
}

#[tokio::test]
async fn test_get_users_by_entity_chat_returns_empty_when_no_users() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("chat-1", EntityType::Chat)
        .await
        .unwrap();

    assert!(result.is_empty());
}

#[tokio::test]
async fn test_get_users_by_entity_project_returns_users() {
    let users = vec![
        user_id("macro|alice@test.com"),
        user_id("macro|bob@test.com"),
        user_id("macro|charlie@test.com"),
    ];
    let repo = MockRepo::new().with_project_users(users.clone());
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("proj-1", EntityType::Project)
        .await
        .unwrap();

    assert_eq!(result.len(), 3);
    assert_eq!(result[0].to_string(), "macro|alice@test.com");
    assert_eq!(result[1].to_string(), "macro|bob@test.com");
    assert_eq!(result[2].to_string(), "macro|charlie@test.com");
}

#[tokio::test]
async fn test_get_users_by_entity_project_returns_empty_when_no_users() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("proj-1", EntityType::Project)
        .await
        .unwrap();

    assert!(result.is_empty());
}

#[tokio::test]
async fn test_get_users_by_entity_thread_returns_users() {
    let users = vec![
        user_id("macro|dave@test.com"),
        user_id("macro|eve@test.com"),
    ];
    let repo = MockRepo::new().with_thread_users(users.clone());
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("thread-1", EntityType::EmailThread)
        .await
        .unwrap();

    assert_eq!(result.len(), 2);
    assert_eq!(result[0].to_string(), "macro|dave@test.com");
    assert_eq!(result[1].to_string(), "macro|eve@test.com");
}

#[tokio::test]
async fn test_get_users_by_entity_thread_returns_empty_when_no_users() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("thread-1", EntityType::EmailThread)
        .await
        .unwrap();

    assert!(result.is_empty());
}

#[tokio::test]
async fn test_get_users_by_entity_channel_returns_bad_request() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("11111111-1111-1111-1111-111111111111", EntityType::Channel)
        .await;

    assert!(matches!(result, Err(AccessError::BadRequest(_))));
}

#[tokio::test]
async fn test_get_users_by_entity_team_returns_bad_request() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("team-1", EntityType::Team)
        .await;

    assert!(matches!(result, Err(AccessError::BadRequest(_))));
}

#[tokio::test]
async fn test_get_users_by_entity_user_returns_bad_request() {
    let repo = MockRepo::new();
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("user-1", EntityType::User)
        .await;

    assert!(matches!(result, Err(AccessError::BadRequest(_))));
}

#[tokio::test]
async fn test_get_users_by_entity_document_with_single_user() {
    let users = vec![user_id("macro|solo@test.com")];
    let repo = MockRepo::new().with_document_users(users.clone());
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("doc-1", EntityType::Document)
        .await
        .unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].to_string(), "macro|solo@test.com");
}

#[tokio::test]
async fn test_get_users_by_entity_project_with_many_users() {
    let users: Vec<MacroUserIdStr<'static>> = (0..50)
        .map(|i| user_id(&format!("macro|user{}@test.com", i)))
        .collect();
    let repo = MockRepo::new().with_project_users(users.clone());
    let service = EntityAccessServiceImpl::new(repo);

    let result = service
        .get_users_by_entity("proj-1", EntityType::Project)
        .await
        .unwrap();

    assert_eq!(result.len(), 50);
    for (i, u) in result.iter().enumerate() {
        assert_eq!(u.to_string(), format!("macro|user{}@test.com", i));
    }
}
