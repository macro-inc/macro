//! Bounded indexed lookups, retaining the caller's order and duplicate keys.

use super::*;

const BATCH_SIZE: usize = 128;

/// Reads a stored record value in one cache format.
pub(super) type RecordDecoder = fn(&[u8]) -> Result<Record, cache_core::codec::CodecError>;

/// Statement sizes a batch is padded up to, so a few statement texts serve
/// every batch and stay in the connection's statement cache, and a batch
/// pads by at most half its size. Padding keys have an empty typename, which
/// no record has.
const BATCH_SIZES: [usize; 13] = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, BATCH_SIZE];

fn padded(count: usize) -> usize {
    BATCH_SIZES
        .into_iter()
        .find(|size| *size >= count)
        .unwrap_or(BATCH_SIZE)
}

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
    connection: &Db,
    keys: &[RecordKey],
) -> Result<Vec<Option<Record>>, TursoStorageError> {
    read_with(connection, keys, decode_record)
}

/// [`read`], with records stored as `decode` reads them: an older cache
/// format's, while a migration carries some of them forward.
pub(super) fn read_with(
    connection: &Db,
    keys: &[RecordKey],
    decode: RecordDecoder,
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
                    Ok(vec![Some(decode(bytes).map_err(|_| {
                        TursoStorageError::reset(PhysicalResetReason::Codec)
                    })?)])
                }
                _ => Err(invariant()),
            },
            _ => Err(invariant()),
        };
    }
    let mut records = Vec::with_capacity(keys.len());
    let mut statement = driver::prepare(connection, &sql(padded(keys.len().min(BATCH_SIZE))))?;
    for batch in keys.chunks(BATCH_SIZE) {
        let size = padded(batch.len());
        if statement.parameters_count() != size * 2 {
            statement = driver::prepare(connection, &sql(size))?;
        }
        let mut parameters = Vec::with_capacity(size * 2);
        for key in batch {
            parameters.push(text(&key.typename));
            parameters.push(text(&key.id));
        }
        parameters.resize_with(size * 2, || text(""));
        let rows = driver::query_prepared(&mut statement, parameters)?;
        if rows.len() != size {
            return Err(invariant());
        }
        let offset = records.len();
        records.resize_with(offset + batch.len(), || None);
        let mut seen = vec![false; size];
        for row in rows {
            let position = usize::try_from(required_i64(&row, 0)?).map_err(|_| invariant())?;
            let slot = seen.get_mut(position).ok_or_else(invariant)?;
            if std::mem::replace(slot, true) || row.len() != 2 {
                return Err(invariant());
            }
            if position >= batch.len() {
                // A padding key: its record is absent.
                if !matches!(required_value(&row, 1)?, Value::Null) {
                    return Err(invariant());
                }
                continue;
            }
            records[offset + position] = match required_value(&row, 1)? {
                Value::Null => None,
                Value::Blob(bytes) => Some(
                    decode(bytes)
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
