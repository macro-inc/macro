//! The router's collaborators, just enough to drive a request: bearer
//! tokens for two people, a grant table per person plus the form's public
//! audience, and a forms service recording the receipts it was handed.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{TimeZone, Utc};
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EditAccessLevel,
    EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType, OwnerAccessLevel,
    RequiredPermission, TeamRole, UserTeamInfo, ViewAccessLevel,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedIdentity,
};
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::{MacroUserId, MacroUserIdStr};
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};
use rootcause::Report;
use uuid::Uuid;

use crate::domain::models::{
    Audience, Form, FormAccess, FormDetail, FormError, FormId, FormLayout, FormStatus, FormTally,
    ListedForm, MyResponse, ResponseSummary, RowId, Submission, SubmissionOutcome, UpdateForm,
};
use crate::domain::ports::{CreateFormCommand, FormsService};
use crate::domain::sharing::FormSharingService;
use crate::inbound::axum_router::{FormsRouterState, forms_router};

pub(super) const OWNER: &str = "macro|owner@forms-router.test";
pub(super) const RESPONDENT: &str = "macro|respondent@forms-router.test";
pub(super) const FORM: FormId = FormId::from_uuid(Uuid::from_u128(0xf0));
pub(super) const ROW: RowId = RowId::from_uuid(Uuid::from_u128(0x40));

/// Accepts the bearer tokens `owner` and `respondent`.
#[derive(Clone, Copy)]
pub(super) struct Tokens;

impl JwtValidator for Tokens {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        let user_id = match jwt {
            "owner" => OWNER,
            "respondent" => RESPONDENT,
            _ => return Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        };
        Ok(ValidatedIdentity {
            user_id: user_id.to_string(),
            fusion_user_id: format!("fusion-{jwt}"),
            organization_id: None,
            permissions: None,
        })
    }
}

pub(super) type Authorization = MacroAuthorizationServiceImpl<Tokens>;

fn authorization_state() -> MacroAuthorizationState<Authorization> {
    MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        Tokens,
        InternalAuthConfig {
            api_key: "forms-router-internal-key".to_string(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )))
}

/// Each person's level on every form and database, and what the public
/// audience answers an anonymous caller.
#[derive(Clone, Default)]
pub(super) struct Grants {
    pub(super) users: HashMap<String, AccessLevel>,
    pub(super) public: Option<AccessLevel>,
}

impl EntityAccessService for Grants {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let level = self
            .users
            .get(user_id.as_ref())
            .copied()
            .ok_or(AccessError::Unauthorized)?;
        EntityAccessReceipt::try_new(
            EntityAccessAuth::Authenticated(
                MacroUserIdStr::try_from(user_id.as_ref().to_string()).expect("a user id"),
            ),
            entity_access::domain::models::Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: level,
            },
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("no bot calls the forms routes here")
    }

    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(match user_id {
            Some(user) => self.users.get(user.as_ref()).copied(),
            None => self.public,
        })
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("the form extractor reads the permission instead")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("the form extractor asks get_access_level")
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        match user_id.and_then(|user| self.users.get(user.as_ref())) {
            Some(level) => Ok(EntityPermission::AccessLevel {
                access_level: *level,
            }),
            None => Err(AccessError::Unauthorized),
        }
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unimplemented!("forms are not CRM entities")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(Vec::new())
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

/// What a receipt the service was handed said.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Handed {
    pub(super) call: &'static str,
    pub(super) entity_id: String,
    pub(super) user: Option<String>,
}

fn handed<Level: RequiredPermission>(
    call: &'static str,
    receipt: &EntityAccessReceipt<Level>,
) -> Handed {
    Handed {
        call,
        entity_id: receipt.entity().entity_id.clone(),
        user: receipt.acting_user_id().map(ToString::to_string),
    }
}

/// A forms service that records every receipt and answers fixed values, or
/// `refusal` when one is set.
#[derive(Default)]
pub(super) struct RecordingForms {
    pub(super) handed: Mutex<Vec<Handed>>,
    pub(super) refusal: Mutex<Option<FormError>>,
}

pub(super) fn form() -> Form {
    let at = Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap();
    Form {
        id: FORM,
        name: "RSVP".into(),
        description: "".into(),
        owner_id: OWNER.into(),
        database_id: models_databases::DatabaseId::from_uuid(Uuid::from_u128(0xdb)),
        table_id: models_databases::TableId::from_uuid(Uuid::from_u128(0x7a)),
        submitted_column_id: None,
        respondent_column_id: None,
        audience: Audience::Public,
        tally_visible: false,
        status: FormStatus::Open,
        closes_at: None,
        confirmation_message: "".into(),
        created_at: at,
        updated_at: at,
    }
}

impl RecordingForms {
    fn answer<Value>(&self, handed: Handed, value: Value) -> Result<Value, FormError> {
        self.handed.lock().unwrap().push(handed);
        match self.refusal.lock().unwrap().take() {
            Some(refusal) => Err(refusal),
            None => Ok(value),
        }
    }

    fn detail(&self, access: FormAccess) -> FormDetail {
        FormDetail {
            form: form(),
            access,
            table_gone: false,
            sections: vec![],
        }
    }
}

impl FormsService for RecordingForms {
    async fn create_form(
        &self,
        creator: databases::domain::models::Viewer,
        command: CreateFormCommand,
    ) -> Result<FormDetail, FormError> {
        let entity_id = match &command.source {
            crate::domain::ports::CreateSource::NewDatabase => String::new(),
            crate::domain::ports::CreateSource::Table { receipt, .. } => {
                receipt.entity().entity_id.clone()
            }
        };
        self.answer(
            Handed {
                call: "create_form",
                entity_id,
                user: Some(creator.user_id.to_string()),
            },
            self.detail(FormAccess::Owner),
        )
    }

    async fn accessible_forms(
        &self,
        viewer: databases::domain::models::Viewer,
    ) -> Result<Vec<ListedForm>, FormError> {
        self.answer(
            Handed {
                call: "accessible_forms",
                entity_id: String::new(),
                user: Some(viewer.user_id.to_string()),
            },
            vec![ListedForm {
                form: form(),
                access: FormAccess::View,
            }],
        )
    }

    async fn forms_for_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<Form>, FormError> {
        self.answer(handed("forms_for_database", &receipt), vec![form()])
    }

    async fn get_form(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<FormDetail, FormError> {
        let detail = self.detail(FormAccess::View);
        self.answer(handed("get_form", &receipt), detail)
    }

    async fn update_form(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        _update: UpdateForm,
    ) -> Result<Form, FormError> {
        self.answer(handed("update_form", &receipt), form())
    }

    async fn put_layout(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        _layout: FormLayout,
    ) -> Result<FormDetail, FormError> {
        let detail = self.detail(FormAccess::Edit);
        self.answer(handed("put_layout", &receipt), detail)
    }

    async fn submit_response(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        _submission: Submission,
    ) -> Result<SubmissionOutcome, FormError> {
        self.answer(
            handed("submit_response", &receipt),
            SubmissionOutcome::Submitted {
                response: crate::domain::models::FormResponseId::from_uuid(Uuid::from_u128(0xe1)),
                row: ROW,
            },
        )
    }

    async fn my_response(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<MyResponse, FormError> {
        self.handed
            .lock()
            .unwrap()
            .push(handed("my_response", &receipt));
        Err(self
            .refusal
            .lock()
            .unwrap()
            .take()
            .unwrap_or(FormError::NoResponse))
    }

    async fn edit_my_response(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        _submission: Submission,
    ) -> Result<SubmissionOutcome, FormError> {
        self.answer(
            handed("edit_my_response", &receipt),
            SubmissionOutcome::Stopped {
                section: crate::domain::models::FormSectionId::from_uuid(Uuid::from_u128(0x5e)),
                message: "No".into(),
            },
        )
    }

    async fn response_summary(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<ResponseSummary, FormError> {
        self.answer(
            handed("response_summary", &receipt),
            ResponseSummary {
                submitted: 1,
                stopped: 0,
                stopped_by_section: vec![],
                rows: 1,
            },
        )
    }

    async fn tally(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<FormTally, FormError> {
        self.answer(handed("tally", &receipt), FormTally { questions: vec![] })
    }

    async fn rename_form(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _name: String,
    ) -> Result<Form, FormError> {
        unimplemented!("renaming is the entity mutation router's")
    }

    async fn trash_form(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), FormError> {
        unimplemented!("trashing is the entity mutation router's")
    }

    async fn restore_form(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), FormError> {
        unimplemented!("restoring is the entity mutation router's")
    }

    async fn delete_form_permanently(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), FormError> {
        unimplemented!("deleting is the entity mutation router's")
    }
}

impl FormSharingService for RecordingForms {
    async fn share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<SharePermissionV2, FormError> {
        self.answer(
            handed("share_permissions", &receipt),
            SharePermissionV2 {
                id: FORM.to_string(),
                link_share: None,
                link_share_access_level: None,
                team_share_access_level: None,
                owner: OWNER.into(),
                channel_share_permissions: Some(vec![]),
            },
        )
    }

    async fn update_share_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _request: UpdateSharePermissionRequestV2,
    ) -> Result<SharePermissionV2, FormError> {
        self.share_permissions(receipt).await
    }
}

/// Every forms route over `grants`, and the service behind it.
pub(super) fn router(grants: Grants) -> (axum::Router, Arc<RecordingForms>) {
    let service = Arc::new(RecordingForms::default());
    let router = forms_router::<RecordingForms, Grants, Authorization, ()>(FormsRouterState::new(
        service.clone(),
        Arc::new(grants),
        authorization_state(),
    ));
    (router, service)
}
