//! The at-least check reads grants only: a link share's level never lifts an
//! explicit accessor over the floor.

use super::EntityAccessDirectory;
use crate::domain::ports::AccessDirectory;
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
    EntityPermission, RequiredPermission, TeamRole, UserTeamInfo,
};
use entity_access::domain::ports::EntityAccessService;
use event_exposure::{EntityType, MinAccessLevel};
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::{MacroUserId, MacroUserIdStr};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

const VIEWER: &str = "macro|viewer@access-directory.test";
const EDITOR: &str = "macro|editor@access-directory.test";
const DOCUMENT: &str = "00000000-0000-0000-0000-0000000000d0";

/// Explicit grants per user, plus a link share whose level
/// `get_access_level` folds in, as the real service does.
#[derive(Clone)]
struct Grants {
    users: HashMap<&'static str, AccessLevel>,
    link_share: Option<AccessLevel>,
}

impl Grants {
    fn shared_by_link_for_edit() -> Self {
        Self {
            users: HashMap::from([(VIEWER, AccessLevel::View), (EDITOR, AccessLevel::Edit)]),
            link_share: Some(AccessLevel::Edit),
        }
    }
}

impl EntityAccessService for Grants {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("the directory never asks for receipts")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("the directory never asks for receipts")
    }

    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let grant = user_id.and_then(|user| self.users.get(user.as_ref()).copied());
        Ok(grant.max(self.link_share))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("the directory never checks access")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("the directory never checks public access")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        unimplemented!("the directory never asks for a permission")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unimplemented!("no CRM entity here")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(self
            .users
            .keys()
            .map(|user| {
                MacroUserIdStr::parse_from_str(user)
                    .expect("a user id")
                    .to_owned()
            })
            .collect())
    }

    async fn get_users_by_entity_at_least(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        min_level: AccessLevel,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(self
            .users
            .iter()
            .filter(|(_, level)| **level >= min_level)
            .map(|(user, _)| {
                MacroUserIdStr::parse_from_str(user)
                    .expect("a user id")
                    .to_owned()
            })
            .collect())
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Ok(None)
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Ok(None)
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(None)
    }
}

#[tokio::test]
async fn a_link_share_does_not_lift_a_viewer_to_editor() {
    let directory = EntityAccessDirectory::new(Arc::new(Grants::shared_by_link_for_edit()));

    let viewer = directory
        .is_accessor_at_least(VIEWER, EntityType::Document, DOCUMENT, MinAccessLevel::Edit)
        .await
        .unwrap();
    let editor = directory
        .is_accessor_at_least(EDITOR, EntityType::Document, DOCUMENT, MinAccessLevel::Edit)
        .await
        .unwrap();

    assert!(
        !viewer,
        "a view grant with an edit link share is not an editor"
    );
    assert!(editor);
}

#[tokio::test]
async fn a_link_only_visitor_is_never_an_accessor_at_any_level() {
    let directory = EntityAccessDirectory::new(Arc::new(Grants::shared_by_link_for_edit()));

    let visitor = directory
        .is_accessor_at_least(
            "macro|visitor@access-directory.test",
            EntityType::Document,
            DOCUMENT,
            MinAccessLevel::Comment,
        )
        .await
        .unwrap();

    assert!(!visitor);
}
