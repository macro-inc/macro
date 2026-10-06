//! Service-level policy tests for team CRM settings: members may write
//! the views fields, governance fields require admin/owner. The repo is
//! a stub so only the service's policy layer is under test.

use super::*;
use crate::domain::contact_listing::{CrmContactListQuery, CrmContactListScope};
use crate::domain::model::CrmPermissionRole;
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use entity_access::domain::models::{
    BotId, BotReceiptScope, Entity, EntityAccessReceipt, EntityPermission, EntityType, TeamRole,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde_json::json;
use std::sync::{Arc, Mutex};

/// Stub [`CompaniesRepository`]: the two settings methods behave like an
/// empty store; everything else panics.
#[derive(Clone, Default)]
struct StubRepo {
    contact_calls: Arc<Mutex<Vec<ContactListCall>>>,
}

#[derive(Debug, PartialEq)]
struct ContactListCall {
    viewer_id: String,
    team: Option<(uuid::Uuid, bool)>,
    limit: u16,
}

impl CompaniesRepository for StubRepo {
    async fn list_contacts_for_soup(
        &self,
        scope: CrmContactListScope<'_>,
        viewer_id: &str,
        query: &CrmContactListQuery,
    ) -> Result<Vec<crate::domain::contact_listing::CrmContactForSoup>, CrmError> {
        let team = match scope {
            CrmContactListScope::Viewer(viewer) => {
                assert_eq!(viewer, viewer_id);
                None
            }
            CrmContactListScope::Team {
                team_id,
                include_hidden,
            } => Some((team_id, include_hidden)),
        };
        self.contact_calls.lock().unwrap().push(ContactListCall {
            viewer_id: viewer_id.to_string(),
            team,
            limit: query.limit,
        });
        Ok(vec![])
    }

    async fn populate_contact(
        &self,
        _team_id: &uuid::Uuid,
        _link_id: &uuid::Uuid,
        _domain: &str,
        _email: &str,
        _name: Option<&str>,
        _first_at: DateTime<Utc>,
        _last_at: DateTime<Utc>,
        _is_sent: bool,
    ) -> Result<(), CrmError> {
        unimplemented!()
    }

    async fn create_company_for_team(
        &self,
        _team_id: &uuid::Uuid,
        _domain: &str,
        _name: &str,
        _now: DateTime<Utc>,
    ) -> Result<CrmCompanyWithContacts, CrmError> {
        unimplemented!()
    }

    async fn create_contact_for_company(
        &self,
        _team_id: &uuid::Uuid,
        _company_id: &uuid::Uuid,
        _email: &str,
        _name: &str,
        _now: DateTime<Utc>,
        _include_hidden: bool,
    ) -> Result<CrmContact, CrmError> {
        unimplemented!()
    }

    async fn lookup_domain_metadata(
        &self,
        _domain: &str,
    ) -> Result<Option<crate::domain::model::DomainMetadata>, CrmError> {
        unimplemented!()
    }

    async fn upsert_domain_metadata(
        &self,
        _domain: &str,
        _metadata: &crate::domain::model::DomainMetadata,
    ) -> Result<(), CrmError> {
        unimplemented!()
    }

    async fn depopulate_contact(
        &self,
        _team_id: &uuid::Uuid,
        _link_id: &uuid::Uuid,
        _domain: &str,
        _email: &str,
    ) -> Result<DepopulateContactOutcome, CrmError> {
        unimplemented!()
    }

    async fn link_contact_pairs_with_sources(
        &self,
        _pairs: &[(uuid::Uuid, String)],
    ) -> Result<Vec<(uuid::Uuid, String)>, CrmError> {
        unimplemented!()
    }

    async fn depopulate_link_in_team(
        &self,
        _team_id: &uuid::Uuid,
        _link_id: &uuid::Uuid,
    ) -> Result<(), CrmError> {
        unimplemented!()
    }

    async fn get_team_id_for_user(&self, _macro_id: &str) -> Result<Option<uuid::Uuid>, CrmError> {
        unimplemented!()
    }

    async fn set_email_sync(
        &self,
        _team_id: &uuid::Uuid,
        _company_id: &uuid::Uuid,
        _email_sync: bool,
    ) -> Result<(), CrmError> {
        Ok(())
    }

    async fn set_company_hidden(
        &self,
        _team_id: &uuid::Uuid,
        _company_id: &uuid::Uuid,
        _hidden: bool,
    ) -> Result<(), CrmError> {
        Ok(())
    }

    async fn set_company_custom_name(
        &self,
        _team_id: &uuid::Uuid,
        _company_id: &uuid::Uuid,
        _name: &str,
        _include_hidden: bool,
    ) -> Result<(), CrmError> {
        unimplemented!()
    }

    async fn set_contact_name(
        &self,
        _team_id: &uuid::Uuid,
        _contact_id: &uuid::Uuid,
        _name: &str,
        _include_hidden: bool,
    ) -> Result<(), CrmError> {
        unimplemented!()
    }

    async fn set_contact_hidden(
        &self,
        _team_id: &uuid::Uuid,
        _contact_id: &uuid::Uuid,
        _hidden: bool,
    ) -> Result<(), CrmError> {
        Ok(())
    }

    async fn crm_scope_precheck(
        &self,
        _team_id: &uuid::Uuid,
        _domains: &[String],
        _addresses: &[String],
    ) -> Result<CrmScopePrecheck, CrmError> {
        unimplemented!()
    }

    #[allow(clippy::too_many_arguments)]
    async fn list_companies_for_soup(
        &self,
        _team_id: &uuid::Uuid,
        _user_id: &str,
        _company_ids: &[uuid::Uuid],
        _hidden: Option<bool>,
        _sort: CrmCompanyListSort,
        _cursor: Option<CrmCompanySoupCursor>,
        _limit: i64,
    ) -> Result<Vec<CrmCompanyForSoup>, CrmError> {
        unimplemented!()
    }

    async fn list_contacts_for_company(
        &self,
        _team_id: &uuid::Uuid,
        _company_id: &uuid::Uuid,
        _include_hidden: bool,
    ) -> Result<Vec<CrmContact>, CrmError> {
        unimplemented!()
    }

    async fn get_contact_for_team(
        &self,
        _team_id: &uuid::Uuid,
        _contact_id: &uuid::Uuid,
        _include_hidden: bool,
    ) -> Result<Option<CrmContact>, CrmError> {
        unimplemented!()
    }

    async fn search_contacts_for_team(
        &self,
        _team_id: &uuid::Uuid,
        _query: &str,
        _limit: i64,
        _include_hidden: bool,
    ) -> Result<Vec<CrmContact>, CrmError> {
        unimplemented!()
    }

    async fn get_contact_by_email_for_team(
        &self,
        _team_id: &uuid::Uuid,
        _email: &str,
        _include_hidden: bool,
    ) -> Result<Option<CrmContact>, CrmError> {
        unimplemented!()
    }

    async fn get_company_for_team(
        &self,
        _team_id: &uuid::Uuid,
        _company_id: &uuid::Uuid,
        _include_hidden: bool,
    ) -> Result<Option<CrmCompanyWithContacts>, CrmError> {
        unimplemented!()
    }

    async fn get_team_settings(&self, _team_id: &uuid::Uuid) -> Result<CrmTeamSettings, CrmError> {
        Ok(CrmTeamSettings::default())
    }

    async fn update_team_settings(
        &self,
        _team_id: &uuid::Uuid,
        patch: &CrmTeamSettingsPatch,
    ) -> Result<CrmTeamSettings, CrmError> {
        // Echo the patch onto defaults so tests can see what got through.
        let mut settings = CrmTeamSettings::default();
        if let Some(role) = patch.edit_stages_role {
            settings.edit_stages_role = role;
        }
        if let Some(views) = &patch.team_views {
            settings.team_views = views.clone();
        }
        if let Some(default_id) = &patch.default_team_view_id {
            settings.default_team_view_id = default_id.clone();
        }
        Ok(settings)
    }
}

fn service() -> CrmServiceImpl<StubRepo, NoOpCompanyMetadataResolver> {
    CrmServiceImpl::new(StubRepo::default(), NoOpCompanyMetadataResolver)
}

fn receipt_with_role(role: TeamRole) -> CrmTeamReceipt<MemberTeamRole> {
    let user = MacroUserIdStr::parse_from_str("macro|user@example.com")
        .unwrap()
        .into_owned();
    CrmTeamReceipt::from_team_receipt(
        EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
            user,
            Entity {
                entity_id: uuid::Uuid::now_v7().to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole { role },
        )
        .unwrap(),
    )
    .unwrap()
}

fn contact_query(limit: u16) -> CrmContactListQuery {
    CrmContactListQuery {
        filter: filter_ast::Expr::Literal(
            item_filters::ast::crm_contact::CrmContactLiteral::Include,
        ),
        sort: CrmCompanyListSort::UpdatedAt,
        cursor: None,
        ascending: false,
        limit,
    }
}

fn bot_receipt(
    team_id: uuid::Uuid,
    scope: BotReceiptScope,
    role: TeamRole,
) -> CrmTeamReceipt<MemberTeamRole> {
    CrmTeamReceipt::from_team_receipt(
        EntityAccessReceipt::try_new_bot(
            BotId::new_from_uuid(uuid::Uuid::from_u128(123)).into_storage_id(),
            scope,
            Entity {
                entity_id: team_id.to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole { role },
        )
        .unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn contact_listing_checks_viewer_and_bounds_page_size() {
    let service = service();
    let access = receipt_with_role(TeamRole::Member);
    let viewer = "macro|user@example.com";
    for (receipt, limit) in [(None, 0), (Some(&access), u16::MAX)] {
        service
            .list_contacts_for_soup(viewer, receipt, contact_query(limit))
            .await
            .unwrap();
    }
    assert_eq!(
        *service.companies_repository.contact_calls.lock().unwrap(),
        vec![
            ContactListCall {
                viewer_id: viewer.into(),
                team: None,
                limit: 1
            },
            ContactListCall {
                viewer_id: viewer.into(),
                team: None,
                limit: MAX_CONTACT_SEARCH_LIMIT
            },
        ]
    );
    let error = service
        .list_contacts_for_soup("macro|other@example.com", Some(&access), contact_query(10))
        .await
        .unwrap_err();
    assert!(matches!(error, CrmError::InvalidRequest(_)));
    assert_eq!(
        service
            .companies_repository
            .contact_calls
            .lock()
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn contact_listing_restricts_team_bots_and_preserves_hidden_permission() {
    let service = service();
    let team_id = uuid::Uuid::from_u128(42);
    for role in [TeamRole::Member, TeamRole::Admin] {
        let access = bot_receipt(team_id, BotReceiptScope::Team { team_id }, role);
        service
            .list_contacts_for_soup("bot-viewer", Some(&access), contact_query(20))
            .await
            .unwrap();
    }
    assert_eq!(
        *service.companies_repository.contact_calls.lock().unwrap(),
        vec![
            ContactListCall {
                viewer_id: "bot-viewer".into(),
                team: Some((team_id, false)),
                limit: 20
            },
            ContactListCall {
                viewer_id: "bot-viewer".into(),
                team: Some((team_id, true)),
                limit: 20
            },
        ]
    );
    for scope in [
        BotReceiptScope::Team {
            team_id: uuid::Uuid::from_u128(43),
        },
        BotReceiptScope::Channel {
            channel_id: uuid::Uuid::from_u128(44),
        },
    ] {
        let access = bot_receipt(team_id, scope, TeamRole::Admin);
        let error = service
            .list_contacts_for_soup("bot-viewer", Some(&access), contact_query(20))
            .await
            .unwrap_err();
        assert!(matches!(error, CrmError::InvalidRequest(_)));
    }
    assert_eq!(
        service
            .companies_repository
            .contact_calls
            .lock()
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn contact_listing_requires_a_user_bot_to_match_its_acting_user() {
    let service = service();
    let viewer = "macro|user@example.com";
    let access = bot_receipt(
        uuid::Uuid::from_u128(42),
        BotReceiptScope::User {
            acting_user: MacroUserIdStr::parse_from_str(viewer).unwrap().into_owned(),
        },
        TeamRole::Member,
    );
    service
        .list_contacts_for_soup(viewer, Some(&access), contact_query(20))
        .await
        .unwrap();
    assert_eq!(
        *service.companies_repository.contact_calls.lock().unwrap(),
        vec![ContactListCall {
            viewer_id: viewer.into(),
            team: None,
            limit: 20
        },]
    );
    let error = service
        .list_contacts_for_soup("macro|other@example.com", Some(&access), contact_query(20))
        .await
        .unwrap_err();
    assert!(matches!(error, CrmError::InvalidRequest(_)));
    assert_eq!(
        service
            .companies_repository
            .contact_calls
            .lock()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn member_can_update_team_views_and_default() {
    let access = receipt_with_role(TeamRole::Member);
    let patch = CrmTeamSettingsPatch {
        team_views: Some(json!([{ "id": "v1" }])),
        default_team_view_id: Some(Some("v1".to_string())),
        ..Default::default()
    };
    let settings = service()
        .update_team_settings(&access, patch)
        .await
        .unwrap();
    assert_eq!(settings.team_views, json!([{ "id": "v1" }]));
    assert_eq!(settings.default_team_view_id, Some("v1".to_string()));
}

#[tokio::test]
async fn member_cannot_update_governance_fields() {
    let access = receipt_with_role(TeamRole::Member);
    for patch in [
        CrmTeamSettingsPatch {
            edit_stages_role: Some(CrmPermissionRole::Owner),
            ..Default::default()
        },
        CrmTeamSettingsPatch {
            move_closed_deals_role: Some(CrmPermissionRole::Owner),
            ..Default::default()
        },
        CrmTeamSettingsPatch {
            delete_records_role: Some(CrmPermissionRole::Owner),
            ..Default::default()
        },
        CrmTeamSettingsPatch {
            closed_stage_ids: Some(Some(vec![uuid::Uuid::now_v7()])),
            ..Default::default()
        },
    ] {
        let err = service()
            .update_team_settings(&access, patch)
            .await
            .unwrap_err();
        assert!(matches!(err, CrmError::SettingsAdminRequired));
    }
}

#[tokio::test]
async fn admin_and_owner_can_update_governance_fields() {
    for role in [TeamRole::Admin, TeamRole::Owner] {
        let access = receipt_with_role(role);
        let patch = CrmTeamSettingsPatch {
            edit_stages_role: Some(CrmPermissionRole::Owner),
            ..Default::default()
        };
        let settings = service()
            .update_team_settings(&access, patch)
            .await
            .unwrap();
        assert_eq!(settings.edit_stages_role, CrmPermissionRole::Owner);
    }
}

#[tokio::test]
async fn team_views_must_be_an_array() {
    let access = receipt_with_role(TeamRole::Admin);
    let patch = CrmTeamSettingsPatch {
        team_views: Some(json!({ "not": "an array" })),
        ..Default::default()
    };
    let err = service()
        .update_team_settings(&access, patch)
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::InvalidRequest(_)));
}

#[tokio::test]
async fn create_company_rejects_blank_name() {
    let access = receipt_with_role(TeamRole::Member);
    for name in ["", "   ", "\t\n"] {
        let err = service()
            .create_company(&access, name, "acme.com")
            .await
            .unwrap_err();
        assert!(matches!(err, CrmError::InvalidRequest(_)), "name {name:?}");
    }
}

#[tokio::test]
async fn create_company_rejects_overlong_name() {
    let access = receipt_with_role(TeamRole::Member);
    let name = "x".repeat(201);
    let err = service()
        .create_company(&access, &name, "acme.com")
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::InvalidRequest(_)));
}

#[tokio::test]
async fn create_company_rejects_malformed_domains() {
    let access = receipt_with_role(TeamRole::Member);
    for domain in [
        "",
        "   ",
        "acme",
        ".acme.com",
        "acme..com",
        "https://acme.com",
        "acme.com/about",
        "user@acme.com",
        "acme.com:8080",
        "acme .com",
    ] {
        let err = service()
            .create_company(&access, "Acme", domain)
            .await
            .unwrap_err();
        assert!(
            matches!(err, CrmError::InvalidRequest(_)),
            "domain {domain:?}"
        );
    }
}

#[tokio::test]
async fn create_company_rejects_generic_email_domains() {
    let access = receipt_with_role(TeamRole::Member);
    for domain in ["gmail.com", "Yahoo.com", "outlook.com"] {
        let err = service()
            .create_company(&access, "Acme", domain)
            .await
            .unwrap_err();
        assert!(
            matches!(err, CrmError::InvalidRequest(_)),
            "domain {domain:?}"
        );
    }
}

fn company_receipt() -> CrmCompanyReceipt<ViewAccessLevel> {
    CrmCompanyReceipt::dangerously_internal(uuid::Uuid::now_v7(), uuid::Uuid::now_v7())
}

#[tokio::test]
async fn set_company_name_rejects_blank_name() {
    let access = company_receipt();
    for name in ["", "   ", "\t\n"] {
        let err = service().set_company_name(&access, name).await.unwrap_err();
        assert!(matches!(err, CrmError::InvalidRequest(_)), "name {name:?}");
    }
}

#[tokio::test]
async fn set_company_name_rejects_overlong_name() {
    let access = company_receipt();
    let name = "x".repeat(201);
    let err = service()
        .set_company_name(&access, &name)
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::InvalidRequest(_)));
}

fn contact_receipt() -> CrmContactReceipt<ViewAccessLevel> {
    CrmContactReceipt::dangerously_internal(uuid::Uuid::now_v7(), uuid::Uuid::now_v7())
}

#[tokio::test]
async fn set_contact_name_rejects_blank_name() {
    let access = contact_receipt();
    for name in ["", "   ", "\t\n"] {
        let err = service().set_contact_name(&access, name).await.unwrap_err();
        assert!(matches!(err, CrmError::InvalidRequest(_)), "name {name:?}");
    }
}

#[tokio::test]
async fn set_contact_name_rejects_overlong_name() {
    let access = contact_receipt();
    let name = "x".repeat(201);
    let err = service()
        .set_contact_name(&access, &name)
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::InvalidRequest(_)));
}

#[tokio::test]
async fn create_contact_rejects_blank_name() {
    let access = company_receipt();
    for name in ["", "   ", "\t\n"] {
        let err = service()
            .create_contact(&access, name, "jane@acme.com")
            .await
            .unwrap_err();
        assert!(matches!(err, CrmError::InvalidRequest(_)), "name {name:?}");
    }
}

#[tokio::test]
async fn create_contact_rejects_malformed_emails() {
    let access = company_receipt();
    for email in [
        "",
        "   ",
        "jane",
        "jane@",
        "@acme.com",
        "jane@acme",
        "ja ne@acme.com",
        "jane@ac me.com",
        "jane@@acme.com",
        "jane@acme.com/path",
    ] {
        let err = service()
            .create_contact(&access, "Jane", email)
            .await
            .unwrap_err();
        assert!(
            matches!(err, CrmError::InvalidRequest(_)),
            "email {email:?}"
        );
    }
}

fn company_edit_receipt_with_role(role: TeamRole) -> CrmCompanyReceipt<EditAccessLevel> {
    CrmCompanyReceipt::dangerously_internal_with_role(
        uuid::Uuid::now_v7(),
        uuid::Uuid::now_v7(),
        role,
    )
}

fn contact_edit_receipt_with_role(role: TeamRole) -> CrmContactReceipt<EditAccessLevel> {
    CrmContactReceipt::dangerously_internal_with_role(
        uuid::Uuid::now_v7(),
        uuid::Uuid::now_v7(),
        role,
    )
}

#[tokio::test]
async fn set_email_sync_requires_admin_role() {
    let err = service()
        .set_email_sync(&company_edit_receipt_with_role(TeamRole::Member), true)
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::AdminRoleRequired));

    for role in [TeamRole::Admin, TeamRole::Owner] {
        service()
            .set_email_sync(&company_edit_receipt_with_role(role), true)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn set_company_hidden_requires_admin_role() {
    let err = service()
        .set_company_hidden(&company_edit_receipt_with_role(TeamRole::Member), true)
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::AdminRoleRequired));

    for role in [TeamRole::Admin, TeamRole::Owner] {
        service()
            .set_company_hidden(&company_edit_receipt_with_role(role), true)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn set_contact_hidden_requires_admin_role() {
    let err = service()
        .set_contact_hidden(&contact_edit_receipt_with_role(TeamRole::Member), true)
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::AdminRoleRequired));

    for role in [TeamRole::Admin, TeamRole::Owner] {
        service()
            .set_contact_hidden(&contact_edit_receipt_with_role(role), true)
            .await
            .unwrap();
    }
}
