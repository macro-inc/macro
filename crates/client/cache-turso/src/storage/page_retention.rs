//! One-time, non-destructive compaction of legacy viewer page snapshots.

use super::*;
use cache_core::page_retention::{SOUP_PAGE_OWNER, compact_soup_pages};

const VERSION_KEY: &str = "soup_page_retention_version";
const VERSION: &str = "1";

pub(super) fn save_version(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    driver::execute(
        connection,
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        vec![text(VERSION_KEY), text(VERSION)],
    )?;
    Ok(())
}

pub(super) fn compact_legacy_pages(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    let rows = driver::query(
        connection,
        "SELECT value FROM meta WHERE key = ?1",
        vec![text(VERSION_KEY)],
    )?;
    if let [row] = rows.as_slice()
        && required_text(row, 0)? == VERSION
    {
        return Ok(());
    }

    // No schema/namespace bump or cache clear. Only the viewer records are
    // visited through the composite primary key, one at a time. The marker and
    // replacements commit together; failed opens can retry without losing data.
    driver::write_transaction(connection, || {
        let mut after: Option<String> = None;
        loop {
            let (sql, values) = match after.as_ref() {
                Some(id) => (
                    SEARCH_REBUILD_RECORDS_AFTER,
                    vec![text(SOUP_PAGE_OWNER), text(id), Value::from_i64(1)],
                ),
                None => (
                    SEARCH_REBUILD_RECORDS,
                    vec![text(SOUP_PAGE_OWNER), Value::from_i64(1)],
                ),
            };
            let rows = driver::query(connection, sql, values)?;
            let Some(row) = rows.first() else {
                break;
            };
            let id = required_text(row, 0)?;
            let mut record = decode_record(&required_blob(row, 1)?)
                .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Codec))?;
            if compact_soup_pages(&mut record) {
                let entries =
                    prepare_records(vec![(EntityKey::entity(SOUP_PAGE_OWNER, &[&id]), record)])?;
                for entry in &entries {
                    require_changed(
                        driver::execute(
                            connection,
                            RECORD_UPSERT,
                            vec![
                                text(&entry.key.typename),
                                text(&entry.key.id),
                                Value::from_blob(entry.value.clone()),
                            ],
                        )?,
                        1,
                    )?;
                }
                write_search_documents(connection, &entries)?;
            }
            after = Some(id);
        }
        save_version(connection)
    })
}
