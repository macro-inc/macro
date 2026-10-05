//! What editors and poll voters read of the responses: the ledger's counts
//! and, for choice questions, how the table's rows answer them.

use std::collections::HashMap;

use databases::domain::models::DatabaseError;
use databases::domain::ports::{DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use macro_event_broker::MacroEventBroker;
use models_databases::{CellValue, ColumnKind, OptionRef, RowId};

use super::layout::question_columns;
use super::{
    FormsServiceImpl, database_error, internal_receipt, receipt_access, receipt_form_id,
    repository_error,
};
use crate::domain::models::{
    FormAccess, FormError, FormSection, FormSectionId, FormTally, QuestionOption, QuestionTally,
    ResponseSummary, SectionCount, TallyBucket, TallyValue,
};
use crate::domain::ports::{Clock, FormAccessDirectory, FormEventPublisher, FormsRepo};

/// One column's tally from its cells.
fn tally_of(
    kind: ColumnKind,
    options: &[QuestionOption],
    cells: &HashMap<RowId, CellValue>,
) -> (u64, Vec<TallyBucket>) {
    // A count of in-memory cells is a usize, at most 64 bits on every
    // target the service builds for, so it always fits a u64.
    let count = |holds: &dyn Fn(&CellValue) -> bool| -> u64 {
        cells.values().filter(|value| holds(value)).count() as u64
    };
    let responses = count(&|value| match value {
        CellValue::Options(options) => !options.is_empty(),
        CellValue::Clear => false,
        _ => true,
    });
    let buckets = match kind {
        ColumnKind::Boolean => [true, false]
            .into_iter()
            .map(|checked| TallyBucket {
                value: TallyValue::Checkbox { checked },
                count: count(&|value| *value == CellValue::Boolean(checked)),
            })
            .collect(),
        _ => options
            .iter()
            .map(|option| TallyBucket {
                value: TallyValue::Option { option: option.id },
                count: count(&|value| {
                    matches!(value, CellValue::Options(held) if held.contains(&OptionRef::Id(option.id)))
                }),
            })
            .collect(),
    };
    (responses, buckets)
}

/// Whether a column of `kind` has a fixed set of values a tally counts.
fn tallied(kind: ColumnKind) -> bool {
    match kind {
        ColumnKind::Select { .. }
        | ColumnKind::SelectNumber { .. }
        | ColumnKind::Tag
        | ColumnKind::Boolean => true,
        ColumnKind::Text
        | ColumnKind::Number
        | ColumnKind::Date
        | ColumnKind::Link
        | ColumnKind::Entity { .. }
        | ColumnKind::Relation { .. } => false,
    }
}

impl<Repository, Databases, Access, Events, Now, Broker>
    FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker>
where
    Repository: FormsRepo,
    Databases: DatabasesService + DatabaseRowReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
{
    pub(super) async fn summary(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<ResponseSummary, FormError> {
        let form = self.live_form(receipt_form_id(receipt)?).await?;
        let table = self.live_table_of(&form).await?;
        let counts = self
            .repository
            .response_counts(form.id)
            .await
            .map_err(repository_error)?;
        let rows = self
            .databases
            .row_count(
                internal_receipt::<ViewAccessLevel>(form.database_id),
                table.table.id,
            )
            .await
            .map_err(|error| match error {
                DatabaseError::NotFound => FormError::TableGone,
                other => database_error(other),
            })?;
        let layout = self
            .repository
            .layout(form.id)
            .await
            .map_err(repository_error)?;
        let order: Vec<FormSectionId> = layout.sections.iter().map(FormSection::id).collect();
        let mut stopped_by_section: Vec<SectionCount> = counts
            .stopped_by_section
            .iter()
            .map(|(section, count)| SectionCount {
                section: *section,
                count: *count,
            })
            .collect();
        // Gates in layout order; gates since removed after them, by id.
        stopped_by_section.sort_by_key(|count| {
            (
                order
                    .iter()
                    .position(|section| *section == count.section)
                    .unwrap_or(order.len()),
                count.section,
            )
        });
        Ok(ResponseSummary {
            submitted: counts.submitted,
            stopped: stopped_by_section.iter().map(|count| count.count).sum(),
            stopped_by_section,
            rows,
        })
    }

    pub(super) async fn count_choices(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<FormTally, FormError> {
        let form = self.live_form(receipt_form_id(receipt)?).await?;
        if receipt_access(receipt) < FormAccess::Edit && !form.tally_visible {
            return Err(FormError::TallyHidden);
        }
        let table = self.live_table_of(&form).await?;
        let columns = question_columns(&table);
        let layout = self
            .repository
            .layout(form.id)
            .await
            .map_err(repository_error)?;
        let mut questions = Vec::new();
        for question in layout.sections.iter().flat_map(|section| match section {
            FormSection::Questions { questions, .. } => questions.as_slice(),
            FormSection::Gate { .. } => &[],
        }) {
            let Some(column) = columns.get(&question.column) else {
                continue;
            };
            if !tallied(column.kind) {
                continue;
            }
            // A column deleted in the grid since the table was read is not
            // asked any more, as one already missing above is not.
            let cells = match self
                .databases
                .column_cells(
                    internal_receipt::<ViewAccessLevel>(form.database_id),
                    form.table_id,
                    question.column,
                )
                .await
            {
                Ok(cells) => cells,
                Err(DatabaseError::NotFound) => continue,
                Err(other) => return Err(database_error(other)),
            };
            let (responses, buckets) = tally_of(column.kind, &column.options, &cells);
            questions.push(QuestionTally {
                question: question.id,
                responses,
                buckets,
            });
        }
        Ok(FormTally { questions })
    }
}
