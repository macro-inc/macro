use super::*;
use crate::domain::{
    models::{AccessError, AccessGrant, AccessLevel, EntityPermission, EntityType},
    ports::{ExplainAccessRepository, ExplainAccessService},
};
use std::future::Future;

#[derive(Clone)]
struct FakeRepo {
    grants: Vec<AccessGrant>,
}

impl ExplainAccessRepository for FakeRepo {
    fn list_access_grants(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> impl Future<Output = Result<Vec<AccessGrant>, AccessError>> + Send {
        let grants = self.grants.clone();
        async move { Ok(grants) }
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("explain@example.com").unwrap()
}

#[tokio::test]
async fn unsupported_types_are_bad_request() {
    let service = ExplainAccessServiceImpl::new(FakeRepo { grants: vec![] });
    let user = user();

    for entity_type in [
        EntityType::User,
        EntityType::ChannelMessage,
        EntityType::Skill,
    ] {
        let error = service
            .explain_access(&user, "id", entity_type)
            .await
            .unwrap_err();
        assert!(matches!(error, AccessError::BadRequest(_)));
    }
}

#[tokio::test]
async fn empty_grants_are_success_with_no_access() {
    let service = ExplainAccessServiceImpl::new(FakeRepo { grants: vec![] });
    let user = user();

    let explanation = service
        .explain_access(&user, "doc-1", EntityType::Document)
        .await
        .unwrap();

    assert_eq!(explanation.effective, None);
    assert!(explanation.grants.is_empty());
}

#[tokio::test]
async fn service_keeps_repo_grants_and_computes_effective() {
    let service = ExplainAccessServiceImpl::new(FakeRepo {
        grants: vec![AccessGrant::PublicLink {
            access_level: AccessLevel::Comment,
        }],
    });
    let user = user();

    let explanation = service
        .explain_access(&user, "doc-1", EntityType::Document)
        .await
        .unwrap();

    assert_eq!(
        explanation.effective,
        Some(EntityPermission::AccessLevel {
            access_level: AccessLevel::Comment
        })
    );
    assert_eq!(explanation.grants.len(), 1);
}
