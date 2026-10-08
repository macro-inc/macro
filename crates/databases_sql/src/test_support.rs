//! Fakes of the services the adapter runs on, sharing one [`World`]: the
//! databases service answers details and records ops, entity access mints
//! receipts from the world's grants, Soup answers table rows with Soup's
//! filter semantics, and contacts lists the world's people.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use bot_id::BotId;
use chrono::{DateTime, Utc};
use contacts::domain::models::messages::ContactsNodes;
use contacts::domain::ports::ContactsService;
use databases::domain::models::{
    Awareness, ColumnCast, ColumnConversion, ColumnId, CreateDatabase, Database, DatabaseDetail,
    DatabaseError, DatabaseId, InferColumnType, InferColumnTypeOutcome, ListedDatabase, OpBatch,
    QueryDefinition, QueryId, SavedQuery, SavedQueryError, TableId, Viewer,
};
use databases::domain::ports::DatabasesService;
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, CallChannelInfo, EditAccessLevel, Entity,
    EntityAccessReceipt, EntityPermission, EntityType, OwnerAccessLevel, RequiredPermission,
    TeamRole, UserTeamInfo, ViewAccessLevel,
};
use entity_access::domain::ports::EntityAccessService;
use filter_ast::Expr;
use item_filters::ast::EntityFilterAst;
use item_filters::ast::database_row::DatabaseRowLiteral;
use item_filters::ast::properties::{PropertiesLiteral, PropertyMatchValue};
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::{MacroUserId, MacroUserIdStr};
use model_owner::Owner;
use models_databases::{DatabaseOp, OpResult};
use models_grouping::GroupByField;
use models_pagination::Paginated;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::{DataType, PropertyOwner};
use models_soup::database_row::SoupDatabaseRow;
use models_soup::item::SoupItem;
use models_soup::properties::SoupProperty;
use soup::domain::models::grouping::ItemGroupingInfo;
use soup::domain::models::{
    EnrichedSoupItem, GroupedSortRequest, IntoSoupReqAst, SoupErr, SoupPropertiesField, SoupRequest,
};
use soup::domain::ports::{SoupOutput, SoupService};
use uuid::Uuid;

use crate::service::DatabasesSql;

pub(crate) const OWNER: &str = "macro|owner@macro.com";
pub(crate) const VIEWER: &str = "macro|viewer@macro.com";
pub(crate) const STRANGER: &str = "macro|stranger@macro.com";

pub(crate) fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

/// `id` acting through the Macro AI bot, as the agent tools act.
pub(crate) fn agent_for(id: &'static str) -> Viewer {
    Viewer {
        user_id: user(id),
        acting_bot: Some(bot_id::MACRO_AI_BOT_ID),
    }
}

/// Everything the fakes know.
#[derive(Default)]
pub(crate) struct World {
    /// Every database, in creation order. Their `grant` is replaced by the
    /// viewer's when they are answered.
    pub(crate) databases: Vec<DatabaseDetail>,
    /// `(user, database, level)`.
    pub(crate) grants: Vec<(&'static str, DatabaseId, AccessLevel)>,
    /// Every row of every table, oldest first.
    pub(crate) rows: Vec<StoredRow>,
    /// The people every viewer knows.
    pub(crate) contacts: Vec<&'static str>,
    /// Every batch of ops the databases service applied.
    pub(crate) applied: Vec<AppliedOps>,
    /// What the databases service answers each batch of ops with, in order.
    pub(crate) op_answers: VecDeque<Result<Vec<OpResult>, DatabaseError>>,
    /// Every question the databases service stored.
    pub(crate) saved: Vec<(Option<DatabaseId>, QueryDefinition)>,
    pub(crate) created: Vec<CreateDatabase>,
    pub(crate) guarded:
        Vec<std::collections::HashMap<TableId, databases::domain::models::TableVersion>>,
    /// The filter of every Soup read, in order.
    pub(crate) soup_reads: Vec<EntityFilterAst>,
}

/// One table row, its cells keyed by property definition.
#[derive(Clone)]
pub(crate) struct StoredRow {
    pub(crate) id: Uuid,
    pub(crate) table_id: TableId,
    pub(crate) database_id: DatabaseId,
    pub(crate) position: String,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) cells: Vec<(Uuid, PropertyValue)>,
}

/// A batch of ops, with the receipt it was applied under.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AppliedOps {
    pub(crate) database: DatabaseId,
    pub(crate) level: AccessLevel,
    pub(crate) acting_bot: Option<BotId>,
    pub(crate) ops: Vec<DatabaseOp>,
}

pub(crate) type Shared = Arc<Mutex<World>>;

/// The adapter over fakes sharing `world`.
pub(crate) fn sql(
    world: &Shared,
) -> DatabasesSql<FakeDatabases, FakeAccess, FakeSoup, FakeContacts> {
    DatabasesSql::new(
        Arc::new(FakeDatabases(world.clone())),
        Arc::new(FakeAccess(world.clone())),
        Arc::new(FakeSoup(world.clone())),
        Arc::new(FakeContacts(world.clone())),
    )
}

#[derive(Clone)]
pub(crate) struct FakeDatabases(pub(crate) Shared);

impl DatabasesService for FakeDatabases {
    async fn apply_ops_with_changes(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: databases::domain::models::Viewer,
        _batch: databases::domain::models::OpBatch,
    ) -> Result<databases::domain::models::AppliedOps, DatabaseError> {
        unimplemented!("the SQL adapter does not undo")
    }

    async fn undo_change(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: databases::domain::models::Viewer,
        _change: databases::domain::models::ChangeId,
    ) -> Result<databases::domain::journal::UndoOutcome, DatabaseError> {
        unimplemented!("the SQL adapter does not undo")
    }

    async fn table_changes(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _table_id: databases::domain::models::TableId,
        _since: databases::domain::models::TableVersion,
    ) -> Result<databases::domain::journal::TableChanges, DatabaseError> {
        unimplemented!("the SQL adapter reads no table changes")
    }

    async fn row_history(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _table_id: databases::domain::models::TableId,
        _row_id: databases::domain::models::RowId,
    ) -> Result<Vec<databases::domain::journal::RowHistoryEntry>, DatabaseError> {
        unimplemented!("the SQL adapter reads no history")
    }

    async fn view_positions(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _view_id: databases::domain::models::ViewId,
    ) -> Result<Vec<databases::domain::models::CardPosition>, DatabaseError> {
        unimplemented!("the SQL adapter reads no card places")
    }

    async fn database_details(&self, viewer: Viewer) -> Result<Vec<DatabaseDetail>, DatabaseError> {
        let world = self.0.lock().unwrap();
        Ok(world
            .databases
            .iter()
            .filter_map(|detail| {
                let (_, _, grant) = world.grants.iter().find(|(user, database, _)| {
                    *user == viewer.user_id.as_ref() && *database == detail.database.id
                })?;
                Some(DatabaseDetail {
                    grant: *grant,
                    ..detail.clone()
                })
            })
            .collect())
    }

    async fn apply_ops(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        batch: OpBatch,
    ) -> Result<Vec<OpResult>, DatabaseError> {
        let ops = batch.ops;
        let EntityPermission::AccessLevel { access_level } = receipt.entity_permission() else {
            panic!("receipts here carry an access level");
        };
        let database = receipt.entity().entity_id.parse().expect("a database id");
        let mut world = self.0.lock().unwrap();
        world.guarded.push(batch.base_versions);
        world.applied.push(AppliedOps {
            database,
            level: *access_level,
            acting_bot: viewer.acting_bot,
            ops: ops.clone(),
        });
        world
            .op_answers
            .pop_front()
            .expect("the test answers every batch of ops")
    }

    async fn save_query(
        &self,
        viewer: Viewer,
        database_id: Option<DatabaseId>,
        definition: QueryDefinition,
    ) -> Result<SavedQuery, SavedQueryError> {
        self.0
            .lock()
            .unwrap()
            .saved
            .push((database_id, definition.clone()));
        Ok(SavedQuery {
            id: QueryId::from_uuid(Uuid::from_u128(0x0e11)),
            definition,
            database_id,
            created_by: Some(viewer.user_id.as_ref().to_string()),
            created_at: Utc::now(),
        })
    }

    async fn create_database(&self, input: CreateDatabase) -> Result<Database, DatabaseError> {
        let database = Database {
            id: DatabaseId::new(),
            name: input.name.clone(),
            owner_id: input.owner_id.to_string(),
            created_at: Utc::now(),
            trashed_at: None,
        };
        self.0.lock().unwrap().created.push(input);
        Ok(database)
    }
    async fn list_databases(&self, _: Viewer) -> Result<Vec<ListedDatabase>, DatabaseError> {
        unimplemented!("SQL reads databases in detail")
    }
    async fn get_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<DatabaseDetail, DatabaseError> {
        self.0
            .lock()
            .unwrap()
            .databases
            .iter()
            .find(|database| database.database.id.to_string() == receipt.entity().entity_id)
            .cloned()
            .ok_or(DatabaseError::NotFound)
    }
    async fn rename_database(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        name: String,
    ) -> Result<Database, DatabaseError> {
        let mut world = self.0.lock().unwrap();
        let database = world
            .databases
            .iter_mut()
            .find(|database| database.database.id.to_string() == receipt.entity().entity_id)
            .unwrap();
        database.database.name = name;
        Ok(database.database.clone())
    }
    async fn trash_database(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("SQL never trashes a database")
    }
    async fn restore_database(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("SQL never restores a database")
    }
    async fn delete_database_permanently(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("SQL never deletes a database")
    }
    async fn infer_column_type(
        &self,
        _: EntityAccessReceipt<EditAccessLevel>,
        _: InferColumnType,
    ) -> Result<InferColumnTypeOutcome, DatabaseError> {
        unimplemented!("SQL never infers a column type")
    }
    async fn column_casts(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        _: TableId,
        _: ColumnId,
    ) -> Result<Vec<ColumnCast>, DatabaseError> {
        unimplemented!("SQL never previews a type change")
    }
    async fn column_conversion(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        _: TableId,
        _: ColumnId,
        _: models_databases::ColumnKind,
    ) -> Result<ColumnConversion, DatabaseError> {
        unimplemented!("SQL never converts a column into another")
    }
    async fn share_awareness(
        &self,
        _: EntityAccessReceipt<ViewAccessLevel>,
        _: Viewer,
        _: Awareness,
    ) -> Result<(), DatabaseError> {
        unimplemented!("SQL never shares awareness")
    }
    async fn get_query(&self, _: Viewer, _: QueryId) -> Result<SavedQuery, SavedQueryError> {
        unimplemented!("SQL never reads a saved query back")
    }
}

/// Mints receipts from the world's grants.
#[derive(Clone)]
pub(crate) struct FakeAccess(pub(crate) Shared);

impl FakeAccess {
    fn level(&self, user: &str, entity_id: &str) -> Option<AccessLevel> {
        let database: DatabaseId = entity_id.parse().ok()?;
        self.0
            .lock()
            .unwrap()
            .grants
            .iter()
            .find(|(grantee, granted, _)| *grantee == user && *granted == database)
            .map(|(_, _, level)| *level)
    }
}

impl EntityAccessService for FakeAccess {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let user = MacroUserIdStr::try_from(user_id.as_ref().to_string()).expect("valid user id");
        let access_level = self
            .level(user.as_ref(), entity_id)
            .ok_or(AccessError::Unauthorized)?;
        EntityAccessReceipt::try_new_authenticated_user(
            user,
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel { access_level },
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let user = scope.user_id().expect("a user-scoped agent").clone();
        let access_level = self
            .level(user.as_ref(), entity_id)
            .ok_or(AccessError::Unauthorized)?;
        EntityAccessReceipt::try_new_bot(
            bot_id.into_storage_id(),
            (&scope).into(),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel { access_level },
        )
    }

    async fn get_access_level(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unimplemented!("SQL only mints receipts")
    }
    async fn check_access(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("SQL only mints receipts")
    }
    async fn check_public_access(
        &self,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!("SQL only mints receipts")
    }
    async fn get_entity_permission(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        unimplemented!("SQL only mints receipts")
    }
    async fn get_crm_entity_permission_with_team(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unimplemented!("SQL never touches CRM entities")
    }
    async fn get_users_by_entity(
        &self,
        _: &str,
        _: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unimplemented!("SQL only mints receipts")
    }
    async fn get_call_channel(&self, _: &Uuid) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!("SQL never touches calls")
    }
    async fn get_call_channel_by_channel_id(
        &self,
        _: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!("SQL never touches calls")
    }
    async fn get_user_team(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unimplemented!("SQL never touches teams")
    }
}

/// Answers the world's rows, newest first, in one page, filtered the way
/// Soup filters: a property literal is membership, `NOT` its complement.
#[derive(Clone)]
pub(crate) struct FakeSoup(pub(crate) Shared);

impl FakeSoup {
    fn matching(&self, filter: &EntityFilterAst) -> Vec<StoredRow> {
        let mut world = self.0.lock().unwrap();
        world.soup_reads.push(filter.clone());
        let mut rows: Vec<StoredRow> = world
            .rows
            .iter()
            .filter(|row| {
                filter
                    .database_row_filter
                    .as_deref()
                    .is_some_and(|rows| row_matches(rows, row))
                    && filter
                        .properties_filter
                        .as_deref()
                        .is_none_or(|properties| properties_match(properties, row))
            })
            .cloned()
            .collect();
        rows.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        rows
    }
}

fn row_matches(expr: &Expr<DatabaseRowLiteral>, row: &StoredRow) -> bool {
    match expr {
        Expr::And(a, b) => row_matches(a, row) && row_matches(b, row),
        Expr::Or(a, b) => row_matches(a, row) || row_matches(b, row),
        Expr::Not(a) => !row_matches(a, row),
        Expr::Literal(DatabaseRowLiteral::TableId(table)) => {
            row.table_id == TableId::from_uuid(*table)
        }
        Expr::Literal(DatabaseRowLiteral::Id(id)) => row.id == *id,
    }
}

fn properties_match(expr: &Expr<PropertiesLiteral>, row: &StoredRow) -> bool {
    match expr {
        Expr::And(a, b) => properties_match(a, row) && properties_match(b, row),
        Expr::Or(a, b) => properties_match(a, row) || properties_match(b, row),
        Expr::Not(a) => !properties_match(a, row),
        Expr::Literal(literal) => row.cells.iter().any(|(definition, value)| {
            *definition == literal.property_definition_id
                && match (value, &literal.value) {
                    (PropertyValue::SelectOption(ids), PropertyMatchValue::SelectOption(id)) => {
                        ids.contains(id)
                    }
                    (PropertyValue::EntityRef(references), PropertyMatchValue::EntityRef(id)) => {
                        references
                            .iter()
                            .any(|reference| reference.entity_id == id.to_string())
                    }
                    _ => false,
                }
        }),
    }
}

/// A row as Soup returns it.
pub(crate) fn soup_item(row: &StoredRow) -> SoupItem<SoupPropertiesField> {
    SoupItem::DatabaseRow(SoupDatabaseRow {
        id: row.id,
        table_id: row.table_id.into_uuid(),
        database_id: row.database_id.into_uuid(),
        position: row.position.clone(),
        owner_id: Owner::User(user(OWNER)),
        created_by: None,
        created_at: row.created_at,
        updated_at: row.created_at,
        extra: SoupPropertiesField::new(
            row.cells
                .iter()
                .map(|(definition, value)| SoupProperty {
                    id: Uuid::new_v4(),
                    definition: PropertyDefinition {
                        id: *definition,
                        owner: PropertyOwner::System,
                        display_name: String::new(),
                        data_type: DataType::String,
                        is_multi_select: false,
                        specific_entity_type: None,
                        created_at: row.created_at,
                        updated_at: row.created_at,
                        is_system: false,
                        is_metadata: false,
                    },
                    value: Some(value.clone()),
                })
                .collect(),
        ),
    })
}

impl SoupService for FakeSoup {
    async fn get_user_soup_with_properties<T>(
        &self,
        request: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        let request = request.into_ast().map_err(SoupErr::AstErr)?;
        let filter = request
            .cursor
            .filter()
            .clone()
            .expect("table reads always filter");
        let items = self
            .matching(&filter)
            .iter()
            .map(|row| EnrichedSoupItem::from(soup_item(row)))
            .collect();
        Ok(SoupOutput::Simple(Paginated::from_parts(items, None)))
    }

    async fn get_user_soup_grouped(
        &self,
        request: GroupedSortRequest<'_>,
    ) -> Result<impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>> + Send, SoupErr> {
        let GroupByField::Property {
            property_definition_id,
            ..
        } = request.grouping.field
        else {
            panic!("SQL groups by a property");
        };
        let rows = self.matching(request.cursor.filter());
        let mut bins: Vec<(String, Vec<&StoredRow>)> = Vec::new();
        for row in &rows {
            let keys: Vec<String> = match row
                .cells
                .iter()
                .find(|(definition, _)| *definition == property_definition_id)
            {
                Some((_, PropertyValue::SelectOption(ids))) if !ids.is_empty() => {
                    ids.iter().map(Uuid::to_string).collect()
                }
                Some((_, PropertyValue::EntityRef(references))) if !references.is_empty() => {
                    references
                        .iter()
                        .map(|reference| reference.entity_id.clone())
                        .collect()
                }
                _ => vec![String::new()],
            };
            for key in keys {
                match bins.iter_mut().find(|(bin, _)| *bin == key) {
                    Some((_, members)) => members.push(row),
                    None => bins.push((key, vec![row])),
                }
            }
        }
        // As Soup answers: up to ten items a group, numbered from 1.
        Ok(bins
            .into_iter()
            .flat_map(|(key, members)| {
                let total_group_count = members.len();
                members
                    .into_iter()
                    .take(10)
                    .enumerate()
                    .map(move |(index, member)| ItemGroupingInfo {
                        key: key.clone(),
                        total_group_count,
                        index_in_group: index + 1,
                        item: soup_item(member),
                    })
            })
            .collect::<Vec<_>>()
            .into_iter())
    }

    async fn get_user_soup<T>(
        &self,
        _: SoupRequest<T>,
        _: Option<EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>>,
    ) -> Result<SoupOutput<T>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unimplemented!("SQL reads rows with their properties")
    }
    async fn get_user_soup_with_frecency<T>(
        &self,
        _: SoupRequest<T>,
        _: Option<EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unimplemented!("SQL never reads frecency")
    }
    async fn get_user_soup_with_properties_and_frecency<T>(
        &self,
        _: SoupRequest<T>,
        _: Option<EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unimplemented!("SQL never reads frecency")
    }
    async fn caller_tag_sets<'a>(
        &self,
        _: MacroUserIdStr<'a>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, SoupErr> {
        unimplemented!("SQL never reads tag sets")
    }
}

#[derive(Clone)]
pub(crate) struct FakeContacts(pub(crate) Shared);

impl ContactsService for FakeContacts {
    async fn query_contacts(
        &self,
        _: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .contacts
            .iter()
            .map(|id| user(id))
            .collect())
    }

    async fn add_contact_nodes(&self, _: ContactsNodes) -> Result<(), rootcause::Report> {
        unimplemented!("SQL never adds contacts")
    }
}

/// The literals a read's row filter names, in order.
pub(crate) fn row_literals(filter: &EntityFilterAst) -> Vec<DatabaseRowLiteral> {
    fn walk(expr: &Expr<DatabaseRowLiteral>, out: &mut Vec<DatabaseRowLiteral>) {
        match expr {
            Expr::And(left, right) | Expr::Or(left, right) => {
                walk(left, out);
                walk(right, out);
            }
            Expr::Not(inner) => walk(inner, out),
            Expr::Literal(literal) => out.push(literal.clone()),
        }
    }
    let mut out = Vec::new();
    if let Some(expr) = filter.database_row_filter.as_deref() {
        walk(expr, &mut out);
    }
    out
}
