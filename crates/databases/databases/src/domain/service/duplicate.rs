//! Duplicating a database: the source is read whole, every id it holds is
//! swapped for a new one, and the copy is written as one batch that also
//! creates the database.

use databases_types::views::{CardPosition, ViewLayout};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;
use serde::de::DeserializeOwned;

use super::*;
use crate::domain::catalog::{ColumnEntry, StorageTable};
use crate::domain::derivation::Derivation;
use crate::domain::duplicate::{DatabaseDuplicateRepo, DatabaseDuplicateService};
use crate::domain::journal::{JournalPlan, RestoredRow};
use crate::domain::models::{
    Column, ColumnConfig, DatabaseView, NewDefinition, Write, Writes, WritesOutcome,
};
use properties_types::service::property_definition_with_options::PropertyDefinitionWithOptions;

/// Most rows a duplicate copies; a larger database is refused rather than
/// read whole into memory.
const MAX_DUPLICATED_ROWS: usize = 50_000;

/// Everything a copy is made from, read from the source.
struct Source {
    database: Database,
    tables: Vec<Table>,
    columns: Vec<Column>,
    definitions: HashMap<PropertyDefinitionId, PropertyDefinitionWithOptions>,
    views: Vec<DatabaseView>,
    positions: HashMap<ViewId, Vec<CardPosition>>,
    rows: HashMap<TableId, Vec<RowRef>>,
    cells: HashMap<RowId, HashMap<PropertyDefinitionId, PropertyValue>>,
    /// Other databases relation columns point at that the duplicator can see.
    visible_targets: HashSet<DatabaseId>,
    /// The rows of those databases' tables the relations point at.
    target_rows: HashMap<TableId, HashSet<RowId>>,
    /// The definitions the source shares with something beyond it (a
    /// person's, a team's) that the duplicator may bind too.
    bindable: HashSet<PropertyDefinitionId>,
}

/// Old ids to new ones. Every id the source holds is a UUIDv7, so a value
/// naming any of them is rewritten wherever in it the id sits.
struct Remap(HashMap<Uuid, Uuid>);

impl Remap {
    fn insert(&mut self, old: Uuid) -> Uuid {
        *self.0.entry(old).or_insert_with(Uuid::now_v7)
    }

    fn id(&self, old: Uuid) -> Uuid {
        self.0.get(&old).copied().unwrap_or(old)
    }

    /// `value` with every id it names swapped for its new one.
    fn value<T: Serialize + DeserializeOwned>(&self, value: &T) -> Result<T, DatabaseError> {
        let mut json = serde_json::to_value(value).map_err(repository_error)?;
        self.rewrite(&mut json);
        serde_json::from_value(json).map_err(repository_error)
    }

    /// A cell with the options and rows it names swapped; its text is the
    /// user's and stays as it is.
    fn cell(&self, value: &PropertyValue) -> PropertyValue {
        match value {
            PropertyValue::SelectOption(options) => {
                PropertyValue::SelectOption(options.iter().map(|option| self.id(*option)).collect())
            }
            PropertyValue::EntityRef(references) => PropertyValue::EntityRef(
                references
                    .iter()
                    .map(|reference| properties_types::EntityReference {
                        entity_id: Uuid::parse_str(&reference.entity_id)
                            .map(|id| self.id(id).to_string())
                            .unwrap_or_else(|_| reference.entity_id.clone()),
                        ..reference.clone()
                    })
                    .collect(),
            ),
            value => value.clone(),
        }
    }

    fn rewrite(&self, json: &mut serde_json::Value) {
        match json {
            serde_json::Value::String(text) => {
                if let Ok(old) = Uuid::parse_str(text)
                    && let Some(new) = self.0.get(&old)
                {
                    *text = new.to_string();
                }
            }
            serde_json::Value::Array(items) => items.iter_mut().for_each(|item| self.rewrite(item)),
            serde_json::Value::Object(fields) => {
                fields.values_mut().for_each(|field| self.rewrite(field))
            }
            serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {
            }
        }
    }
}

/// "<name> copy", the source's name cut short when the suffix would push
/// it past the longest name allowed.
fn copy_name(name: &str) -> String {
    const SUFFIX: &str = " copy";
    let base: String = name
        .chars()
        .take(MAX_NAME_LEN.saturating_sub(SUFFIX.chars().count()))
        .collect();
    format!("{}{SUFFIX}", base.trim_end())
}

/// The batch that writes `copy` from `source`: its tables, columns with
/// their definitions and options, rows with their cells, views and card
/// places, in that order, so each write names only what came before it.
fn plan(
    source: &Source,
    copy: &Database,
    created_by: MacroUserIdStr<'static>,
) -> Result<Writes, DatabaseError> {
    let mut remap = Remap(HashMap::from([(
        source.database.id.into_uuid(),
        copy.id.into_uuid(),
    )]));
    // A relation into a database the duplicator cannot see goes, and the
    // views lose it as they would if it were deleted.
    let dropped: Vec<ColumnId> = source
        .columns
        .iter()
        .filter(|column| match &column.config {
            Some(ColumnConfig::Link { database_id, .. }) => {
                *database_id != source.database.id && !source.visible_targets.contains(database_id)
            }
            _ => false,
        })
        .map(|column| column.id)
        .collect();
    let columns: Vec<&Column> = source
        .columns
        .iter()
        .filter(|column| !dropped.contains(&column.id))
        .collect();
    // The copy gets its own definition for each the source owns, and for
    // each shared one the duplicator may not bind, keeping its values.
    let owned = |definition: &PropertyDefinitionWithOptions| {
        definition.definition.owner
            == properties_types::shared::PropertyOwner::Database {
                database_id: source.database.id.into_uuid(),
            }
            || !source.bindable.contains(&definition.definition.id)
    };
    for table in &source.tables {
        remap.insert(table.id.into_uuid());
    }
    for column in &columns {
        remap.insert(column.id.into_uuid());
        let Some(definition) = source.definitions.get(&column.property_definition_id) else {
            continue;
        };
        if owned(definition) {
            remap.insert(definition.definition.id);
            for option in &definition.property_options {
                remap.insert(option.id);
            }
        }
    }
    for rows in source.rows.values() {
        for row in rows {
            remap.insert(row.id.into_uuid());
        }
    }
    for view in &source.views {
        remap.insert(view.id.into_uuid());
    }
    let table_id = |id: TableId| TableId::from_uuid(remap.id(id.into_uuid()));
    let definition_id = |id: PropertyDefinitionId| remap.id(id);

    let mut writes = Vec::new();
    for table in &source.tables {
        writes.push(Write::CreateTable {
            table_id: table_id(table.id),
            name: table.name.clone(),
        });
    }

    let mut created: Vec<PropertyDefinitionId> = Vec::new();
    for column in &columns {
        let definition = source
            .definitions
            .get(&column.property_definition_id)
            .filter(|definition| owned(definition))
            .filter(|definition| !created.contains(&definition.definition.id));
        if let Some(definition) = definition {
            created.push(definition.definition.id);
        }
        writes.push(Write::CreateColumn {
            column: Column {
                id: ColumnId::from_uuid(remap.id(column.id.into_uuid())),
                table_id: table_id(column.table_id),
                property_definition_id: definition_id(column.property_definition_id),
                position: column.position.clone(),
                config: remap.value(&column.config)?,
                display_name: column.display_name.clone(),
                infer_type: column.infer_type,
                // Protections belong to the feature using the source's
                // column, a form say, which the copy does not have.
                protections: Vec::new(),
                nullable: column.nullable,
            },
            definition: definition.map(|definition| {
                let mut options = definition.property_options.clone();
                options.sort_by_key(|option| option.display_order);
                NewDefinition {
                    id: definition_id(definition.definition.id),
                    name: definition.definition.display_name.clone(),
                    data_type: definition.definition.data_type,
                    is_multi_select: definition.definition.is_multi_select,
                    specific_entity_type: definition.definition.specific_entity_type,
                    options: options
                        .iter()
                        .map(|option| {
                            (
                                OptionId::from_uuid(remap.id(option.id)),
                                option.value.clone(),
                            )
                        })
                        .collect(),
                }
            }),
        });
    }

    // A new definition's options take the palette's colours; give them the
    // source's.
    for id in &created {
        let Some(definition) = source.definitions.get(id) else {
            continue;
        };
        let tables: Vec<TableId> = columns
            .iter()
            .filter(|column| column.property_definition_id == *id)
            .map(|column| table_id(column.table_id))
            .collect();
        let Some(first) = tables.first().copied() else {
            continue;
        };
        for option in &definition.property_options {
            writes.push(Write::UpdateOption {
                table_id: first,
                tables: tables.clone(),
                definition_id: definition_id(*id),
                option_id: OptionId::from_uuid(remap.id(option.id)),
                value: None,
                color: Some(option.color.clone()),
            });
        }
    }

    // Formula values are stored like other cells; the store computes the
    // copy's once its rows are in, from its own columns.
    let mut derivations = Vec::new();
    for table in &source.tables {
        let entry = StorageTable {
            table: Table {
                id: table_id(table.id),
                database_id: copy.id,
                ..table.clone()
            },
            columns: columns
                .iter()
                .filter(|column| column.table_id == table.id)
                .filter_map(|column| {
                    let definition = source.definitions.get(&column.property_definition_id)?;
                    Some((column, definition))
                })
                .map(|(column, definition)| {
                    Ok(ColumnEntry {
                        column: Column {
                            id: ColumnId::from_uuid(remap.id(column.id.into_uuid())),
                            table_id: table_id(column.table_id),
                            property_definition_id: definition_id(column.property_definition_id),
                            config: remap.value(&column.config)?,
                            protections: Vec::new(),
                            ..(*column).clone()
                        },
                        definition: remap.value(definition)?,
                        writable: true,
                    })
                })
                .collect::<Result<_, DatabaseError>>()?,
            views: Vec::new(),
        };
        derivations.extend(Derivation::every(&entry));
    }

    let mut related_rows = Vec::new();
    for table in &source.tables {
        let rows = source.rows.get(&table.id).map(Vec::as_slice).unwrap_or(&[]);
        if rows.is_empty() {
            continue;
        }
        let table_columns: Vec<&&Column> = columns
            .iter()
            .filter(|column| column.table_id == table.id)
            .filter(|column| !matches!(column.config, Some(ColumnConfig::Derived { .. })))
            .collect();
        let mut cells = Vec::with_capacity(rows.len());
        for row in rows {
            let held = source.cells.get(&row.id);
            let mut row_cells = Vec::new();
            for column in &table_columns {
                let Some(value) = held.and_then(|held| held.get(&column.property_definition_id))
                else {
                    continue;
                };
                let value = match (&column.config, value) {
                    // A removed row can still be named by a relation cell;
                    // the copy names only rows that are there.
                    (
                        Some(ColumnConfig::Link {
                            table_id: target, ..
                        }),
                        PropertyValue::EntityRef(references),
                    ) => {
                        let live = source
                            .rows
                            .get(target)
                            .map(|rows| rows.iter().map(|row| row.id).collect::<HashSet<_>>())
                            .or_else(|| source.target_rows.get(target).cloned())
                            .unwrap_or_default();
                        let references: Vec<_> = references
                            .iter()
                            .filter(|reference| {
                                reference
                                    .entity_id
                                    .parse::<RowId>()
                                    .is_ok_and(|row| live.contains(&row))
                            })
                            .cloned()
                            .collect();
                        if references.is_empty() {
                            continue;
                        }
                        let value = remap.cell(&PropertyValue::EntityRef(references));
                        if let PropertyValue::EntityRef(references) = &value {
                            for reference in references {
                                if let Ok(related) = reference.entity_id.parse::<RowId>() {
                                    related_rows.push((table_id(*target), related));
                                }
                            }
                        }
                        value
                    }
                    (_, value) => remap.cell(value),
                };
                row_cells.push((definition_id(column.property_definition_id), value));
            }
            cells.push(row_cells);
        }
        writes.push(Write::InsertRows {
            table_id: table_id(table.id),
            rows: cells,
            // The batch's derivations store every formula value below.
            derivation: None,
            restored: rows
                .iter()
                .map(|row| RestoredRow {
                    id: RowId::from_uuid(remap.id(row.id.into_uuid())),
                    position: row.position.clone(),
                })
                .collect(),
            ids: Vec::new(),
        });
    }

    let now = Utc::now();
    for view in &source.views {
        let mut query = view.query.clone();
        let mut layout = Some(view.layout.clone());
        for column in &dropped {
            let next_title = columns
                .iter()
                .find(|kept| kept.table_id == view.table_id)
                .map(|kept| kept.id);
            query = query.without_column(*column);
            layout = layout.and_then(|layout| layout.without_column(*column, next_title));
        }
        let Some(layout) = layout else {
            continue;
        };
        let copied = DatabaseView {
            id: ViewId::from_uuid(remap.id(view.id.into_uuid())),
            database_id: copy.id,
            table_id: table_id(view.table_id),
            name: view.name.clone(),
            position: view.position.clone(),
            query: remap.value(&query)?,
            layout: remap.value(&layout)?,
            created_at: now,
            updated_at: now,
        };
        writes.push(Write::CreateView {
            view: copied.clone(),
        });
        if let Some(write) = card_places(source, &remap, view, &copied)? {
            writes.push(write);
        }
    }

    Ok(Writes {
        database_id: copy.id,
        created_by,
        writes,
        related_rows,
        expected_versions: Vec::new(),
        // The copy's history starts at the copy: none of the source's
        // changes are its to undo.
        journal: JournalPlan::default(),
        derivations,
    })
}

/// Where a board's cards sit in the copy. The batch has no write that only
/// places cards, so the places go with a move of the last placed card into
/// the lane it is already in.
fn card_places(
    source: &Source,
    remap: &Remap,
    view: &DatabaseView,
    copied: &DatabaseView,
) -> Result<Option<Write>, DatabaseError> {
    let ViewLayout::Board { group_by, .. } = &view.layout else {
        return Ok(None);
    };
    let live: HashSet<RowId> = source
        .rows
        .get(&view.table_id)
        .into_iter()
        .flatten()
        .map(|row| row.id)
        .collect();
    let placed: Vec<&CardPosition> = source
        .positions
        .get(&view.id)
        .into_iter()
        .flatten()
        .filter(|place| live.contains(&place.row))
        .collect();
    let (Some(last), Some(grouping)) = (
        placed.last(),
        source.columns.iter().find(|column| column.id == *group_by),
    ) else {
        return Ok(None);
    };
    let value = source
        .cells
        .get(&last.row)
        .and_then(|cells| cells.get(&grouping.property_definition_id))
        .map(|value| remap.cell(value));
    Ok(Some(Write::MoveCard {
        table_id: copied.table_id,
        view_id: copied.id,
        row: RowId::from_uuid(remap.id(last.row.into_uuid())),
        positions: placed
            .iter()
            .map(|place| remap.value(*place))
            .collect::<Result<_, _>>()?,
        cell: (remap.id(grouping.property_definition_id), value),
    }))
}

impl<Repository, Definitions, Cells, Events, Access, Broker>
    DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    /// Read the source whole: schema, views, card places, rows and cells.
    async fn duplicate_source(
        &self,
        database: Database,
        tables: Vec<Table>,
        viewer: &Viewer,
    ) -> Result<Source, DatabaseError> {
        let table_ids: Vec<TableId> = tables.iter().map(|table| table.id).collect();
        let columns = self
            .repository
            .columns_for_tables(&table_ids)
            .await
            .map_err(repository_error)?;
        let views = self
            .repository
            .views_for_tables(&table_ids)
            .await
            .map_err(repository_error)?;
        let mut positions = HashMap::new();
        for view in &views {
            if matches!(view.layout, ViewLayout::Board { .. }) {
                let places = self
                    .repository
                    .view_positions(view.id)
                    .await
                    .map_err(repository_error)?;
                positions.insert(view.id, places);
            }
        }
        let mut rows = HashMap::new();
        let mut count = 0;
        for table in &table_ids {
            let refs = self
                .repository
                .row_refs(*table)
                .await
                .map_err(repository_error)?;
            count += refs.len();
            if count > MAX_DUPLICATED_ROWS {
                return Err(DatabaseError::from(SchemaError::DuplicateTooLarge));
            }
            rows.insert(*table, refs);
        }
        let row_ids: Vec<RowId> = rows.values().flatten().map(|row| row.id).collect();
        let cells = self.cells.cells(&row_ids).await.map_err(repository_error)?;
        let mut definition_ids: Vec<PropertyDefinitionId> = columns
            .iter()
            .map(|column| column.property_definition_id)
            .collect();
        definition_ids.sort();
        definition_ids.dedup();
        let definitions: HashMap<PropertyDefinitionId, PropertyDefinitionWithOptions> = self
            .definitions
            .definitions(&definition_ids)
            .await
            .map_err(repository_error)?
            .into_iter()
            .map(|definition| (definition.definition.id, definition))
            .collect();
        let mut visible_targets = HashSet::new();
        for column in &columns {
            if let Some(ColumnConfig::Link { database_id, .. }) = &column.config
                && *database_id != database.id
                && !visible_targets.contains(database_id)
                && self
                    .access
                    .database_access(viewer, *database_id)
                    .await
                    .map_err(repository_error)?
                    .is_some()
            {
                visible_targets.insert(*database_id);
            }
        }
        let mut target_rows: HashMap<TableId, HashSet<RowId>> = HashMap::new();
        for column in &columns {
            if let Some(ColumnConfig::Link {
                database_id,
                table_id,
            }) = &column.config
                && visible_targets.contains(database_id)
                && !target_rows.contains_key(table_id)
            {
                let refs = self
                    .repository
                    .row_refs(*table_id)
                    .await
                    .map_err(repository_error)?;
                target_rows.insert(*table_id, refs.into_iter().map(|row| row.id).collect());
            }
        }
        let mut bindable = HashSet::new();
        for definition in definitions.values() {
            let shared = definition.definition.owner
                != properties_types::shared::PropertyOwner::Database {
                    database_id: database.id.into_uuid(),
                };
            if shared
                && self
                    .definitions
                    .bindable_definition(database.id, viewer, definition.definition.id)
                    .await
                    .map_err(repository_error)?
                    .is_some()
            {
                bindable.insert(definition.definition.id);
            }
        }
        Ok(Source {
            database,
            tables,
            columns,
            definitions,
            views,
            positions,
            rows,
            cells,
            visible_targets,
            target_rows,
            bindable,
        })
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker> DatabaseDuplicateService
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore + DatabaseDuplicateRepo,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    #[tracing::instrument(skip(self, receipt, owner, acting_bot, name), fields(database_id = %receipt.entity().entity_id, copy_id = tracing::field::Empty, tables = tracing::field::Empty, rows = tracing::field::Empty), err)]
    async fn duplicate_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        owner: MacroUserIdStr<'static>,
        acting_bot: Option<bot_id::BotId>,
        name: Option<String>,
    ) -> Result<Database, DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        let (database, tables) = self
            .repository
            .get_database(database_id)
            .await
            .map_err(repository_error)?
            .ok_or(DatabaseError::NotFound)?;
        if database.trashed_at.is_some() {
            return Err(DatabaseError::NotFound);
        }
        let name = validate_name(&name.unwrap_or_else(|| copy_name(&database.name)))?;
        let viewer = Viewer {
            user_id: owner.clone(),
            acting_bot: None,
        };
        let source = self.duplicate_source(database, tables, &viewer).await?;
        let span = tracing::Span::current();
        span.record("tables", source.tables.len());
        span.record("rows", source.rows.values().map(Vec::len).sum::<usize>());
        let copy = Database {
            id: DatabaseId::generate(),
            name,
            owner_id: owner.to_string(),
            created_at: Utc::now(),
            trashed_at: None,
            // Copies start outside any folder: filing one shares it with the
            // folder's members, which takes its own permission.
            project_id: None,
        };
        let writes = plan(&source, &copy, owner.clone())?;
        span.record("copy_id", tracing::field::display(copy.id));
        let table_versions = match self
            .cells
            .duplicate_database(&copy, &writes)
            .await
            .map_err(repository_error)?
        {
            WritesOutcome::Applied { table_versions, .. } => table_versions,
            WritesOutcome::TableNotFound(_) => return Err(DatabaseError::NotFound),
            refused => {
                return Err(DatabaseError::Repo(
                    rootcause::report!("the duplicate was refused: {refused:?}").into_dynamic(),
                ));
            }
        };
        self.emit(DatabaseMacroEvent::created(DatabaseCreatedMetadata {
            database_id: copy.id,
            owner: owner.clone(),
            name: copy.name.clone(),
            created_at: copy.created_at,
            attribution: events::Attribution::acting(owner, acting_bot),
        }));
        let mut changes: Vec<(DatabaseId, TableId, TableVersion)> = table_versions
            .into_iter()
            .map(|(table, version)| (copy.id, table, version))
            .collect();
        changes.sort_by_key(|(_, table, _)| *table);
        self.publish(receipt_attribution(&receipt), &changes).await;
        Ok(copy)
    }
}
