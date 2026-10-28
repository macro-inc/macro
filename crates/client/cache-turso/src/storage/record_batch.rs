//! Bounded indexed lookups, retaining the caller's order and duplicate keys.

use super::*;

const BATCH_SIZE: usize = 128;

fn sql(count: usize) -> String {
    let values = (0..count)
        .map(|index| format!("({index}, ?, ?)"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "WITH requested(position, typename, id) AS (VALUES {values}) \
         SELECT q.position, r.value FROM requested AS q \
         LEFT JOIN records AS r ON r.__typename = q.typename AND r.id = q.id"
    )
}

pub(super) fn read(
    connection: &Arc<Connection>,
    keys: &[RecordKey],
) -> Result<Vec<Option<Record>>, TursoStorageError> {
    if let [key] = keys {
        let rows = driver::query(
            connection,
            RECORD_GET,
            vec![text(&key.typename), text(&key.id)],
        )?;
        return match rows.as_slice() {
            [] => Ok(vec![None]),
            [row] => match required_value(row, 0)? {
                Value::Blob(bytes) => {
                    Ok(vec![Some(decode_record(bytes).map_err(|_| {
                        TursoStorageError::reset(PhysicalResetReason::Codec)
                    })?)])
                }
                _ => Err(invariant()),
            },
            _ => Err(invariant()),
        };
    }
    let mut records = Vec::with_capacity(keys.len());
    let mut statement = driver::prepare(connection, &sql(keys.len().min(BATCH_SIZE)))?;
    for batch in keys.chunks(BATCH_SIZE) {
        if statement.parameters_count() != batch.len() * 2 {
            statement = driver::prepare(connection, &sql(batch.len()))?;
        }
        let parameters = batch
            .iter()
            .flat_map(|key| [text(&key.typename), text(&key.id)])
            .collect();
        let rows = driver::query_prepared(&mut statement, parameters)?;
        if rows.len() != batch.len() {
            return Err(invariant());
        }
        let offset = records.len();
        records.resize_with(offset + batch.len(), || None);
        let mut seen = vec![false; batch.len()];
        for row in rows {
            let position = usize::try_from(required_i64(&row, 0)?).map_err(|_| invariant())?;
            let slot = seen.get_mut(position).ok_or_else(invariant)?;
            if std::mem::replace(slot, true) || row.len() != 2 {
                return Err(invariant());
            }
            records[offset + position] = match required_value(&row, 1)? {
                Value::Null => None,
                Value::Blob(bytes) => Some(
                    decode_record(bytes)
                        .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Codec))?,
                ),
                _ => return Err(invariant()),
            };
        }
    }
    Ok(records)
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;
