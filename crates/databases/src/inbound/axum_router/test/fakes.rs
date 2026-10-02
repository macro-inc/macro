//! The router's collaborators, just enough to drive a request: a `valid`
//! bearer token, one fixed grant, and a service recording applied batches.

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::routing::post;

use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EditAccessLevel,
    EntityAccessReceipt, EntityPermission, EntityType, OwnerAccessLevel, RequiredPermission,
    TeamRole, UserTeamInfo, ViewAccessLevel,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedIdentity,
};
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::{MacroUserId, MacroUserIdStr};
use models_databases::{ColumnKind, OpResult};
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};
use rootcause::Report;
use uuid::Uuid;

use crate::domain::models::{
    Awareness, ColumnCast, ColumnConversion, ColumnId, CreateDatabase, Database, DatabaseDetail,
    DatabaseError, DatabaseId, InferColumnType, InferColumnTypeOutcome, ListedDatabase, OpBatch,
    QueryDefinition, QueryId, SavedQuery, SavedQueryError, Table, TableId, Viewer,
};
use crate::domain::ports::DatabasesService;
use crate::domain::sharing::DatabaseSharingService;
use crate::domain::transfer::{DatabaseTransferService, ImportTable};
use crate::inbound::axum_router::casts::column_conversion_handler;
use crate::inbound::axum_router::ops::apply_ops_handler;
use crate::inbound::axum_router::{DatabasesRouterState, databases_router};

const USER: &str = "macro|ops-router@macro.com";

/// Accepts the bearer token `valid` as [`USER`].
#[derive(Clone, Copy)]
struct ValidToken;

impl JwtValidator for ValidToken {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        match jwt {
            "valid" => Ok(ValidatedIdentity {
                user_id: USER.to_string(),
                fusion_user_id: "fusion-ops-router".to_string(),
                organization_id: None,
                permissions: None,
            }),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }
}

type Authorization = MacroAuthorizationServiceImpl<ValidToken>;

fn authorization_state() -> MacroAuthorizationState<Authorization> {
    MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        ValidToken,
        InternalAuthConfig {
            api_key: "ops-router-internal-key".to_string(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )))
}

/// The ops route alone, for a caller holding `level` on every database, and
/// the service behind it.
pub(super) fn ops_router(level: AccessLevel) -> (Router, Arc<RecordingService>) {
    let service = Arc::new(RecordingService::default());
    let state = DatabasesRouterState::new(
        service.clone(),
        Arc::new(GrantingAccess(level)),
        authorization_state(),
    );
    let router = Router::new()
        .route(
            "/{id}/ops",
            post(apply_ops_handler::<RecordingService, GrantingAccess, Authorization>),
        )
        .with_state(state);
    (router, service)
}

/// The conversion route alone, for a caller holding `level` on every
/// database, and the service behind it.
pub(super) fn conversion_router(level: AccessLevel) -> (Router, Arc<RecordingService>) {
    let service = Arc::new(RecordingService::default());
    let state = DatabasesRouterState::new(
        service.clone(),
        Arc::new(GrantingAccess(level)),
        authorization_state(),
    );
    let router = Router::new()
        .route(
            "/{id}/tables/{table_id}/columns/{column_id}/conversion",
            post(column_conversion_handler::<RecordingService, GrantingAccess, Authorization>),
        )
        .with_state(state);
    (router, service)
}

/// Every databases route, for a caller holding `level` on every database,
/// and the service behind them.
pub(super) fn full_router(level: AccessLevel) -> (Router, Arc<RecordingService>) {
    let service = Arc::new(RecordingService::default());
    let router = databases_router::<RecordingService, GrantingAccess, Authorization, ()>(
        DatabasesRouterState::new(
            service.clone(),
            Arc::new(GrantingAccess(level)),
            authorization_state(),
        ),
    );
    (router, service)
}

/// Grants every caller the one level it holds.
#[derive(Clone)]
struct GrantingAccess(AccessLevel);

impl EntityAccessService for GrantingAccess {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("the database extractor reads the permission instead")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("no bot calls the ops route here")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(Some(self.0))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Ok(self.0)
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Unauthorized)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Ok(EntityPermission::AccessLevel {
            access_level: self.0,
        })
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unimplemented!("databases are not CRM entities")
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

/// Records the batches that reached it, and answers each with no results,
/// or with `refusal` when one is set; records the conversions asked for and
/// answers each with `conversion`. The routes under test call nothing else.
#[derive(Default)]
pub(super) struct RecordingService {
    pub(super) applied: Mutex<Vec<OpBatch>>,
    pub(super) refusal: Mutex<Option<DatabaseError>>,
    pub(super) conversions: Mutex<Vec<(TableId, ColumnId, ColumnKind)>>,
    pub(super) conversion: Mutex<Option<ColumnConversion>>,
    pub(super) created: Mutex<Vec<CreateDatabase>>,
}

const ONLY_OPS: &str =
    "the routes under test call only apply_ops, column_conversion and create_database";

/// The database [`RecordingService`] answers every creation with.
pub(super) fn created_database() -> Database {
    Database {
        id: DatabaseId::from_uuid(Uuid::from_u128(0x0dbb)),
        name: "Launch".into(),
        owner_id: USER.into(),
        created_at: chrono::DateTime::from_timestamp(1_790_000_000, 0).unwrap(),
        trashed_at: None,
    }
}

impl DatabasesService for RecordingService {
    async fn apply_ops(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: Viewer,
        batch: OpBatch,
    ) -> Result<Vec<OpResult>, DatabaseError> {
        self.applied.lock().unwrap().push(batch);
        match self.refusal.lock().unwrap().take() {
            Some(refusal) => Err(refusal),
            None => Ok(Vec::new()),
        }
    }

    async fn apply_ops_with_changes(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        batch: OpBatch,
    ) -> Result<crate::domain::models::AppliedOps, DatabaseError> {
        let results = self.apply_ops(receipt, viewer, batch).await?;
        Ok(crate::domain::models::AppliedOps {
            results,
            changes: Vec::new(),
        })
    }

    async fn undo_change(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: crate::domain::models::Viewer,
        _change: crate::domain::models::ChangeId,
    ) -> Result<crate::domain::journal::UndoOutcome, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }

    async fn table_changes(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _table_id: crate::domain::models::TableId,
        _since: crate::domain::models::TableVersion,
    ) -> Result<crate::domain::journal::TableChanges, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }

    async fn row_history(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        _: crate::domain::models::TableId,
        _: crate::domain::models::RowId,
    ) -> Result<Vec<crate::domain::journal::RowHistoryEntry>, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }

    async fn view_positions(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        _: crate::domain::models::ViewId,
    ) -> Result<Vec<crate::domain::models::CardPosition>, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }

    async fn create_database(&self, command: CreateDatabase) -> Result<Database, DatabaseError> {
        self.created.lock().unwrap().push(command);
        Ok(created_database())
    }
    async fn list_databases(&self, _: Viewer) -> Result<Vec<ListedDatabase>, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn database_details(&self, _: Viewer) -> Result<Vec<DatabaseDetail>, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn get_database(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<DatabaseDetail, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn rename_database(
        &self,
        _: EntityAccessReceipt<EditAccessLevel>,
        _: String,
    ) -> Result<Database, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn trash_database(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn restore_database(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn delete_database_permanently(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn infer_column_type(
        &self,
        _: EntityAccessReceipt<EditAccessLevel>,
        _: InferColumnType,
    ) -> Result<InferColumnTypeOutcome, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn column_casts(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        _: TableId,
        _: ColumnId,
    ) -> Result<Vec<ColumnCast>, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn column_conversion(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
        to: ColumnKind,
    ) -> Result<ColumnConversion, DatabaseError> {
        self.conversions
            .lock()
            .unwrap()
            .push((table_id, column_id, to));
        Ok(self
            .conversion
            .lock()
            .unwrap()
            .take()
            .expect("the test sets the conversion it answers"))
    }
    async fn share_awareness(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        _: Viewer,
        _: Awareness,
    ) -> Result<(), DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn save_query(
        &self,
        _: Viewer,
        _: Option<DatabaseId>,
        _: QueryDefinition,
    ) -> Result<SavedQuery, SavedQueryError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn get_query(&self, _: Viewer, _: QueryId) -> Result<SavedQuery, SavedQueryError> {
        unimplemented!("{ONLY_OPS}")
    }
}

impl DatabaseSharingService for RecordingService {
    async fn share_permissions(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<SharePermissionV2, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
    async fn update_share_permissions(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
        _: UpdateSharePermissionRequestV2,
    ) -> Result<SharePermissionV2, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
}

impl DatabaseTransferService for RecordingService {
    async fn import_table(
        &self,
        _: EntityAccessReceipt<EditAccessLevel>,
        _: Viewer,
        _: ImportTable,
    ) -> Result<Table, DatabaseError> {
        unimplemented!("{ONLY_OPS}")
    }
}
