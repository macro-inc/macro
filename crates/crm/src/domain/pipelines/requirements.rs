//! Stage-entry policy over the shared operation protocol. The pipeline write
//! guard serializes rule changes and writes; the table version also fences
//! changes made by the underlying storage domain.

use super::*;
use models_databases::{
    CellValue, CellWrite, ColumnChange, DatabaseOp, OptionId, OptionRef, RowChanges, RowsChange,
    ViewChange, ViewId,
    views::{RequestedLayout, ViewLayout},
};
use std::collections::{BTreeMap, HashSet};

/// Fields required when a deal enters a particular option of a stage column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageRequirement {
    /// Single-select column identifying the stage, independent of its name.
    #[schema(value_type = Uuid)]
    pub stage_column_id: ColumnId,
    /// Stable option identity; renaming the stage preserves the rule.
    #[schema(value_type = Uuid)]
    pub stage_id: OptionId,
    /// Fields that must be present. Empty removes the rule for this stage.
    #[schema(value_type = Vec<Uuid>)]
    pub required_column_ids: Vec<ColumnId>,
}

pub(super) fn validate_rule(
    table: &TableDetail,
    rule: &StageRequirement,
) -> Result<(), PipelineError> {
    let stage = table
        .columns
        .iter()
        .find(|c| c.column.id == rule.stage_column_id)
        .ok_or(PipelineError::Invalid("Choose an existing stage field"))?;
    if stage.definition.definition.data_type != DataType::SelectString
        || stage.definition.definition.is_multi_select
        || !stage
            .definition
            .property_options
            .iter()
            .any(|o| o.id == rule.stage_id.into_uuid())
    {
        return Err(PipelineError::Invalid(
            "Choose an existing stage in a single-select field",
        ));
    }
    let mut seen = HashSet::new();
    for id in &rule.required_column_ids {
        let column = table
            .columns
            .iter()
            .find(|c| c.column.id == *id)
            .ok_or(PipelineError::Invalid("Choose an existing required field"))?;
        if *id == rule.stage_column_id
            || !seen.insert(*id)
            || !column.writable
            || column.column.formula().is_some()
            || column.column.is_relation()
        {
            return Err(PipelineError::Invalid(
                "Choose each editable required field once, excluding the stage field",
            ));
        }
    }
    Ok(())
}

impl<R: PipelineRepo, D: DatabaseStorageService, A, S> PipelineServiceImpl<R, D, A, S> {
    #[tracing::instrument(skip_all, fields(pipeline_id = %pipeline.id), err)]
    pub(super) async fn validate_stage_requirements(
        &self,
        pipeline: &Pipeline,
        batch: &mut OpBatch,
    ) -> Result<(), PipelineError> {
        let rules = self
            .repo
            .stage_requirements(pipeline.id)
            .await
            .map_err(storage)?;
        if rules.is_empty() {
            return Ok(());
        }
        let table = self
            .databases
            .storage_tables(pipeline.database_id)
            .await?
            .into_iter()
            .find(|t| t.table.id == pipeline.table_id)
            .ok_or(PipelineError::NotFound)?;
        let version = batch
            .base_versions
            .entry(pipeline.table_id)
            .or_insert(table.table.version);
        if *version != table.table.version {
            return Err(databases::domain::models::DatabaseError::VersionConflict.into());
        }
        let ids = affected_rows(&batch.ops);
        if ids.len() > 10_000 {
            return Err(PipelineError::Invalid(
                "Change at most 10000 entries at a time",
            ));
        }
        let rows = if ids.is_empty() {
            Vec::new()
        } else {
            self.databases
                .storage_row_cells(pipeline.database_id, pipeline.table_id, &ids)
                .await?
        };
        validate_batch(&table, &rules, rows, &batch.ops)
    }
}

fn affected_rows(ops: &[DatabaseOp]) -> Vec<RowId> {
    let mut ids = HashSet::new();
    for op in ops {
        match op {
            DatabaseOp::Rows {
                change:
                    RowsChange::Update {
                        changes: RowChanges::Uniform { rows, .. },
                    },
                ..
            }
            | DatabaseOp::Rows {
                change: RowsChange::Delete { rows },
                ..
            } => ids.extend(rows),
            DatabaseOp::Rows {
                change:
                    RowsChange::Update {
                        changes: RowChanges::PerRow { rows },
                    },
                ..
            } => ids.extend(rows.iter().map(|r| &r.row)),
            DatabaseOp::View {
                change: ViewChange::MoveCard { row, .. },
                ..
            } => {
                ids.insert(*row);
            }
            _ => {}
        }
    }
    ids.into_iter().collect()
}

#[derive(Clone, Default)]
struct Value {
    present: bool,
    options: Vec<OptionId>,
}

impl Value {
    fn stored(value: &PropertyValue) -> Self {
        let present = match value {
            PropertyValue::Str(s) => !s.trim().is_empty(),
            PropertyValue::SelectOption(v) => !v.is_empty(),
            PropertyValue::EntityRef(v) => !v.is_empty(),
            PropertyValue::Link(v) => !v.is_empty(),
            _ => true,
        };
        Self {
            present,
            options: match value {
                PropertyValue::SelectOption(ids) => {
                    ids.iter().copied().map(OptionId::from_uuid).collect()
                }
                _ => vec![],
            },
        }
    }

    fn written(value: &CellValue, labels: Option<&BTreeMap<OptionId, String>>) -> Self {
        let present = match value {
            CellValue::Clear => false,
            CellValue::Text(s) => !s.trim().is_empty(),
            CellValue::Options(v) => !v.is_empty(),
            CellValue::Entities(v) => !v.is_empty(),
            CellValue::Rows(v) => !v.is_empty(),
            CellValue::Link(v) => !v.is_empty(),
            _ => true,
        };
        let options = match value {
            CellValue::Options(options) => options
                .iter()
                .filter_map(|option| match option {
                    OptionRef::Id(id) => Some(*id),
                    OptionRef::Label(label) => labels?
                        .iter()
                        .find(|(_, text)| text.trim().to_lowercase() == label.trim().to_lowercase())
                        .map(|(id, _)| *id),
                })
                .collect(),
            _ => vec![],
        };
        Self { present, options }
    }
}

struct Draft {
    cells: HashMap<ColumnId, Value>,
    original: HashMap<ColumnId, Value>,
    touched: HashSet<ColumnId>,
    inserted: bool,
    op: usize,
    row: Option<usize>,
}

impl Draft {
    fn write(
        &mut self,
        cells: &[CellWrite],
        labels: &HashMap<ColumnId, BTreeMap<OptionId, String>>,
        op: usize,
        row: Option<usize>,
    ) {
        for cell in cells {
            self.cells.insert(
                cell.column,
                Value::written(&cell.value, labels.get(&cell.column)),
            );
            self.touched.insert(cell.column);
        }
        self.op = op;
        self.row = row;
    }
}

fn refuse(op: usize, row: Option<usize>, column: ColumnId, reason: String) -> PipelineError {
    databases::domain::models::DatabaseError::InvalidOp(databases::domain::models::OpRefusal {
        op,
        row,
        column: Some(column),
        reason,
        taken: None,
    })
    .into()
}

fn validate_batch(
    table: &TableDetail,
    rules: &[StageRequirement],
    rows: Vec<StorageRow>,
    ops: &[DatabaseOp],
) -> Result<(), PipelineError> {
    let mut drafts: HashMap<RowId, Draft> = rows
        .into_iter()
        .map(|row| {
            let cells: HashMap<_, _> = row
                .cells
                .iter()
                .map(|(id, value)| (*id, Value::stored(value)))
                .collect();
            (
                row.row_id,
                Draft {
                    original: cells.clone(),
                    cells,
                    touched: HashSet::new(),
                    inserted: false,
                    op: 0,
                    row: None,
                },
            )
        })
        .collect();
    let mut inserted = Vec::new();
    let mut rules = rules.to_vec();
    let mut names: HashMap<_, _> = table
        .columns
        .iter()
        .map(|c| (c.column.id, c.column.name(&c.definition).to_owned()))
        .collect();
    let mut labels: HashMap<_, BTreeMap<_, _>> = table
        .columns
        .iter()
        .map(|c| {
            (
                c.column.id,
                c.definition
                    .property_options
                    .iter()
                    .filter_map(|o| match &o.value {
                        PropertyOptionValue::String(label) => {
                            Some((OptionId::from_uuid(o.id), label.clone()))
                        }
                        _ => None,
                    })
                    .collect(),
            )
        })
        .collect();
    let mut groups: HashMap<ViewId, ColumnId> = table
        .views
        .iter()
        .filter_map(|v| match v.layout {
            ViewLayout::Board { group_by, .. } => Some((v.id, group_by)),
            _ => None,
        })
        .collect();
    for (op_index, op) in ops.iter().enumerate() {
        match op {
            DatabaseOp::Column { column, change, .. } => match change {
                ColumnChange::Rename { name, .. } => {
                    names.insert(*column, name.clone());
                }
                ColumnChange::Delete => {
                    rules.retain(|r| r.stage_column_id != *column);
                    for rule in &mut rules {
                        rule.required_column_ids.retain(|id| id != column);
                    }
                    rules.retain(|rule| !rule.required_column_ids.is_empty());
                }
                ColumnChange::DeleteOption { option } => {
                    rules.retain(|r| r.stage_column_id != *column || r.stage_id != *option);
                    // Deletion also clears cells of rows not otherwise in this batch.
                    // Keep that schema change explicit without scanning the whole pipeline.
                    if rules.iter().any(|r| r.required_column_ids.contains(column)) {
                        return Err(refuse(
                            op_index,
                            None,
                            *column,
                            "Remove this field's stage requirements before deleting its options"
                                .into(),
                        ));
                    }
                    if let Some(options) = labels.get_mut(column) {
                        options.remove(option);
                    }
                    for draft in drafts.values_mut().chain(inserted.iter_mut()) {
                        if let Some(value) = draft.cells.get_mut(column)
                            && value.options.contains(option)
                        {
                            value.options.retain(|id| id != option);
                            value.present = !value.options.is_empty();
                        }
                    }
                }
                ColumnChange::UpdateOption {
                    option,
                    label: Some(label),
                    ..
                } => {
                    labels
                        .entry(*column)
                        .or_default()
                        .insert(*option, label.clone());
                }
                ColumnChange::AddOptions { options } => {
                    for option in options {
                        let existing = labels.entry(*column).or_default();
                        if !existing.values().any(|label| {
                            label.trim().to_lowercase() == option.label.trim().to_lowercase()
                        }) {
                            existing.insert(option.id, option.label.trim().to_owned());
                        }
                    }
                }
                ColumnChange::ChangeType { .. } | ColumnChange::SetFormula { .. }
                    if rules.iter().any(|r| {
                        r.stage_column_id == *column || r.required_column_ids.contains(column)
                    }) =>
                {
                    return Err(refuse(
                        op_index,
                        None,
                        *column,
                        "Remove this field's stage requirements before changing its type".into(),
                    ));
                }
                _ => {}
            },
            DatabaseOp::Rows { change, .. } => match change {
                RowsChange::Insert { rows } => {
                    for (row_index, cells) in rows.iter().enumerate() {
                        let mut draft = Draft {
                            cells: HashMap::new(),
                            original: HashMap::new(),
                            touched: HashSet::new(),
                            inserted: true,
                            op: op_index,
                            row: Some(row_index),
                        };
                        draft.write(cells, &labels, op_index, Some(row_index));
                        inserted.push(draft);
                    }
                }
                RowsChange::Update {
                    changes: RowChanges::Uniform { rows, cells },
                } => {
                    for (row_index, id) in rows.iter().enumerate() {
                        if let Some(draft) = drafts.get_mut(id) {
                            draft.write(cells, &labels, op_index, Some(row_index));
                        }
                    }
                }
                RowsChange::Update {
                    changes: RowChanges::PerRow { rows },
                } => {
                    for (row_index, row) in rows.iter().enumerate() {
                        if let Some(draft) = drafts.get_mut(&row.row) {
                            draft.write(&row.cells, &labels, op_index, Some(row_index));
                        }
                    }
                }
                RowsChange::Delete { rows } => {
                    for id in rows {
                        drafts.remove(id);
                    }
                }
            },
            DatabaseOp::View { view, change, .. } => match change {
                ViewChange::Create { view: new } => update_group(&mut groups, *view, &new.layout),
                ViewChange::Update {
                    layout: Some(layout),
                    ..
                } => update_group(&mut groups, *view, layout),
                ViewChange::Delete => {
                    groups.remove(view);
                }
                ViewChange::MoveCard { row, lane, .. } => {
                    if let (Some(column), Some(draft)) = (groups.get(view), drafts.get_mut(row)) {
                        draft.write(
                            &[CellWrite {
                                column: *column,
                                value: lane.cell(),
                            }],
                            &labels,
                            op_index,
                            None,
                        );
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
    for draft in drafts.values().chain(&inserted) {
        for rule in &rules {
            if !draft
                .cells
                .get(&rule.stage_column_id)
                .is_some_and(|v| v.options.contains(&rule.stage_id))
            {
                continue;
            }
            let entering = draft.inserted
                || !draft
                    .original
                    .get(&rule.stage_column_id)
                    .is_some_and(|v| v.options.contains(&rule.stage_id));
            let editing_required = rule
                .required_column_ids
                .iter()
                .any(|id| draft.touched.contains(id));
            if !entering && !editing_required {
                continue;
            }
            let missing: Vec<_> = rule
                .required_column_ids
                .iter()
                .filter(|id| !draft.cells.get(id).is_some_and(|v| v.present))
                .collect();
            if let Some(column) = missing.first() {
                let stage = labels
                    .get(&rule.stage_column_id)
                    .and_then(|options| options.get(&rule.stage_id))
                    .cloned()
                    .unwrap_or_else(|| rule.stage_id.to_string());
                let fields = missing
                    .iter()
                    .map(|id| names.get(id).cloned().unwrap_or_else(|| id.to_string()))
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(refuse(
                    draft.op,
                    draft.row,
                    **column,
                    format!(
                        "Fill in {fields} before entering {stage}. Your changes were not saved."
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn update_group(groups: &mut HashMap<ViewId, ColumnId>, view: ViewId, layout: &RequestedLayout) {
    match layout {
        RequestedLayout::Board { group_by, .. } => {
            groups.insert(view, *group_by);
        }
        RequestedLayout::Table { .. } | RequestedLayout::Timeline { .. } => {
            groups.remove(&view);
        }
    }
}
