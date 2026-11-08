use super::*;

/// Distinct primary records explicitly written by this batch. Other cells and
/// unchanged references do not require the editor to reselect the record.
pub(super) fn primary_references(
    pipeline: &Pipeline,
    record_type: PipelineRecordType,
    batch: &OpBatch,
) -> Result<std::collections::BTreeSet<Uuid>, PipelineError> {
    use databases_types::{CellValue, CellWrite, DatabaseOp, RowChanges, RowsChange};
    let mut references = std::collections::BTreeSet::new();
    for op in &batch.ops {
        let cells: Vec<&CellWrite> = match op {
            DatabaseOp::Rows {
                change: RowsChange::Insert { rows, .. },
                ..
            } => rows.iter().flatten().collect(),
            DatabaseOp::Rows {
                change:
                    RowsChange::Update {
                        changes: RowChanges::Uniform { cells, .. },
                    },
                ..
            } => cells.iter().collect(),
            DatabaseOp::Rows {
                change:
                    RowsChange::Update {
                        changes: RowChanges::PerRow { rows },
                    },
                ..
            } => rows.iter().flat_map(|row| &row.cells).collect(),
            _ => continue,
        };
        for cell in cells {
            if cell.column != pipeline.primary_column_id {
                continue;
            }
            if let CellValue::Entities(values) = &cell.value {
                for value in values {
                    if value.entity_type != record_type.entity_kind() {
                        return Err(PipelineError::Invalid(
                            "Choose the required CRM record type",
                        ));
                    }
                    references.insert(
                        value
                            .entity_id
                            .parse()
                            .map_err(|_| PipelineError::Invalid("Choose a valid CRM record"))?,
                    );
                }
            }
        }
    }
    Ok(references)
}
