//! Outcome and monetary fields owned by a pipeline, over ordinary database cells.

use std::collections::HashMap;

use databases::domain::{
    models::{ColumnId, ColumnProtection, OpBatch, TableDetail},
    provisioning::ProvisionedColumn,
};
use models_databases::{
    CellValue, CellWrite, ColumnChange, DatabaseOp, OptionRef, RowChanges, RowsChange, ViewChange,
    views::RequestedLayout,
};
use models_properties::{DataType, service::property_option::PropertyOptionValue};
use serde::{Deserialize, Serialize};

use super::pipelines::PipelineError;

#[cfg(test)]
mod test;

/// Supported denominations. Amounts are never converted between these codes.
pub const CURRENCIES: &[&str] = &[
    "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY", "INR", "BRL", "MXN", "SGD", "HKD",
    "NZD", "SEK", "NOK", "DKK", "ZAR", "AED", "KRW", "PLN", "CZK", "ILS", "SAR", "TRY", "THB",
    "IDR", "MYR", "PHP", "TWD", "VND",
];

/// Stable association between a numeric amount and its per-row denomination.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoneyColumn {
    /// The numeric column; renaming it preserves this association.
    #[schema(value_type = uuid::Uuid)]
    pub amount: ColumnId,
    /// The select column containing the currency code.
    #[schema(value_type = uuid::Uuid)]
    pub currency: ColumnId,
}

/// CRM-owned roles for columns in the reusable table.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommercialFields {
    /// Outcome column, absent only for a pipeline from a pre-migration writer.
    #[schema(value_type = Option<uuid::Uuid>)]
    pub outcome: Option<ColumnId>,
    /// Monetary fields, each with an independent per-row currency.
    #[serde(default)]
    pub money: Vec<MoneyColumn>,
}

fn select(name: String, labels: &[&str]) -> ProvisionedColumn {
    ProvisionedColumn {
        id: ColumnId::new(),
        name,
        data_type: DataType::SelectString,
        entity_type: None,
        nullable: true,
        protections: vec![ColumnProtection::Delete, ColumnProtection::ChangeType],
        options: labels
            .iter()
            .map(|label| {
                (
                    macro_uuid::generate_uuid_v7(),
                    PropertyOptionValue::String((*label).into()),
                )
            })
            .collect(),
    }
}

/// Extend a new pipeline's ordinary schema with its commercial system fields.
pub(super) fn provision(columns: &mut Vec<ProvisionedColumn>) -> CommercialFields {
    let outcome = select("Outcome".into(), &["Open", "Won", "Lost"]);
    let mut fields = CommercialFields {
        outcome: Some(outcome.id),
        money: vec![],
    };
    columns.insert(2, outcome);
    let mut index = 0;
    while index < columns.len() {
        let column = &mut columns[index];
        if column.data_type == DataType::Number
            && ["amount", "revenue"].contains(&column.name.to_lowercase().as_str())
        {
            column.protections = vec![ColumnProtection::Delete, ColumnProtection::ChangeType];
            let currency = select(format!("{} currency", column.name), CURRENCIES);
            fields.money.push(MoneyColumn {
                amount: column.id,
                currency: currency.id,
            });
            columns.insert(index + 1, currency);
            index += 1;
        }
        index += 1;
    }
    fields
}

impl CommercialFields {
    /// Whether this column has fixed select options owned by CRM.
    pub fn is_system_select(&self, column: ColumnId) -> bool {
        self.outcome == Some(column) || self.money.iter().any(|pair| pair.currency == column)
    }

    /// Validate every writer through the pipeline boundary and supply insert defaults.
    #[tracing::instrument(
        name = "crm.pipeline.commercial.prepare",
        skip_all,
        fields(table_id = %table.table.id, operations = batch.ops.len()),
        err
    )]
    pub(super) fn prepare(
        &self,
        table: &TableDetail,
        batch: &mut OpBatch,
    ) -> Result<(), PipelineError> {
        // The grouping we validate must still be the grouping used to commit.
        if batch
            .ops
            .iter()
            .any(|op| matches!(op, DatabaseOp::View { .. }))
        {
            batch
                .base_versions
                .entry(table.table.id)
                .or_insert(table.table.version);
        }
        let mut layouts: HashMap<_, RequestedLayout> = table
            .views
            .iter()
            .map(|view| (view.id, view.layout.clone().into()))
            .collect();
        for op in &mut batch.ops {
            match op {
                DatabaseOp::Column { column, change, .. } => {
                    if self.is_system_select(*column)
                        && !matches!(change, ColumnChange::UpdateOption { label: None, .. })
                    {
                        return Err(PipelineError::Invalid(
                            "Outcome and currency fields have fixed names, types and options",
                        ));
                    }
                    if self.money.iter().any(|pair| pair.amount == *column)
                        && !matches!(change, ColumnChange::Rename { .. })
                    {
                        return Err(PipelineError::Invalid(
                            "Keep monetary fields numeric and retain their currency field",
                        ));
                    }
                }
                DatabaseOp::View { view, change, .. } => match change {
                    ViewChange::Create { view: definition } => {
                        layouts.insert(*view, definition.layout.clone());
                    }
                    ViewChange::Update {
                        layout: Some(layout),
                        ..
                    } => {
                        layouts.insert(*view, layout.clone());
                    }
                    ViewChange::Delete => {
                        layouts.remove(view);
                    }
                    ViewChange::MoveCard { lane, .. } => {
                        if let Some(RequestedLayout::Board { group_by, .. }) = layouts.get(view) {
                            self.validate(&[CellWrite {
                                column: *group_by,
                                value: lane.cell(),
                            }])?;
                        }
                    }
                    ViewChange::Update { layout: None, .. } => {}
                },
                DatabaseOp::Rows { change, .. } => match change {
                    RowsChange::Insert { rows } => {
                        for cells in rows {
                            self.validate(cells)?;
                            if let Some(column) = self.outcome {
                                default_cell(table, cells, column, "Open")?;
                            }
                            for pair in &self.money {
                                default_cell(table, cells, pair.currency, "USD")?;
                            }
                        }
                    }
                    RowsChange::Update {
                        changes: RowChanges::Uniform { cells, .. },
                    } => self.validate(cells)?,
                    RowsChange::Update {
                        changes: RowChanges::PerRow { rows },
                    } => {
                        for row in rows {
                            self.validate(&row.cells)?;
                        }
                    }
                    RowsChange::Delete { .. } => {}
                },
                DatabaseOp::Table { .. } | DatabaseOp::ReorderTables { .. } => {}
            }
        }
        Ok(())
    }

    fn validate(&self, cells: &[CellWrite]) -> Result<(), PipelineError> {
        for cell in cells {
            if self.is_system_select(cell.column) {
                match &cell.value {
                    CellValue::Options(values) if values.len() == 1 => {}
                    _ => {
                        return Err(PipelineError::Invalid(
                            "Choose one Outcome or currency; these fields cannot be empty",
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}

fn default_cell(
    table: &TableDetail,
    cells: &mut Vec<CellWrite>,
    column: ColumnId,
    label: &str,
) -> Result<(), PipelineError> {
    if cells.iter().any(|cell| cell.column == column) {
        return Ok(());
    }
    let option = table
        .columns
        .iter()
        .find(|detail| detail.column.id == column)
        .and_then(|detail| {
            detail
                .definition
                .property_options
                .iter()
                .find(|option| option.value == PropertyOptionValue::String(label.into()))
        })
        .ok_or(PipelineError::Invalid(
            "Pipeline system fields are incomplete",
        ))?;
    cells.push(CellWrite {
        column,
        value: CellValue::Options(vec![OptionRef::Id(option.id.into())]),
    });
    Ok(())
}
