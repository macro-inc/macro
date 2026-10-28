//! The database operations a workflow sends, built from names and labels.

use std::collections::HashSet;

use databases::domain::models::Viewer;
use models_databases::{
    CellWrite, ColumnChange, ColumnId, DatabaseOp, NewColumn, NewOption, OptionId,
};

use super::{
    FieldInput, FieldKind, NewField, PipelineField, PipelineOverview, WorkflowError, fields,
};

/// The stage field every pipeline starts with.
pub(super) const STAGE_FIELD: &str = "Stage";

/// The cells `set` writes, by field name.
pub(super) fn cells(
    overview: &PipelineOverview,
    set: &[(String, FieldInput)],
    viewer: &Viewer,
) -> Result<Vec<CellWrite>, WorkflowError> {
    let mut seen = HashSet::new();
    set.iter()
        .map(|(name, input)| {
            let field = overview.field(name)?;
            if !seen.insert(field.id) {
                return Err(WorkflowError::Invalid(format!(
                    "\"{}\" is set twice.",
                    field.name
                )));
            }
            Ok(CellWrite {
                column: field.id,
                value: fields::cell_value(field, input, &viewer.user_id)
                    .map_err(WorkflowError::Invalid)?,
            })
        })
        .collect()
}

pub(super) fn select_field<'a>(
    overview: &'a PipelineOverview,
    name: &str,
) -> Result<&'a PipelineField, WorkflowError> {
    let field = overview.field(name)?;
    if matches!(field.kind, FieldKind::Select | FieldKind::Tags) {
        Ok(field)
    } else {
        Err(WorkflowError::Invalid(format!(
            "\"{}\" has no options; only select fields such as Stage do.",
            field.name
        )))
    }
}

pub(super) fn add_options(
    overview: &PipelineOverview,
    field: &PipelineField,
    labels: &[String],
) -> DatabaseOp {
    DatabaseOp::Column {
        table: overview.pipeline.pipeline.table_id,
        column: field.id,
        change: ColumnChange::AddOptions {
            options: labels
                .iter()
                .map(|label| NewOption {
                    id: OptionId::new(),
                    label: label.trim().to_owned(),
                })
                .collect(),
        },
    }
}

pub(super) fn add_field(
    overview: &PipelineOverview,
    field: &NewField,
) -> Result<DatabaseOp, WorkflowError> {
    if !field.options.is_empty() && !field.kind.takes_options() {
        return Err(WorkflowError::Invalid(format!(
            "\"{}\" is not a select field, so it takes no options.",
            field.name
        )));
    }
    Ok(DatabaseOp::Column {
        table: overview.pipeline.pipeline.table_id,
        column: ColumnId::new(),
        change: ColumnChange::Create {
            definition: NewColumn::New {
                name: field.name.trim().to_owned(),
                kind: field.kind.column_kind(),
                options: field
                    .options
                    .iter()
                    .map(|label| NewOption {
                        id: OptionId::new(),
                        label: label.trim().to_owned(),
                    })
                    .collect(),
                infer_type: false,
            },
            after: None,
        },
    })
}
