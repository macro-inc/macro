use crate::config::Config;
use anyhow::Context;
use email_db_client::threads::update::{
    AttachmentFlagBatch, backfill_attachment_kind_flags_in_blocks,
    backfill_link_attachment_kind_flags, email_attachments_block_count,
};
use sqlx::types::Uuid;
use std::time::Duration;

/// Tries of one batch before the pass stops at it.
const BATCH_TRIES: u32 = 5;
/// Batches between progress lines.
const PROGRESS_EVERY: u64 = 20;
/// SQLSTATE of a statement that ran past `statement_timeout`.
const STATEMENT_TIMEOUT: &str = "57014";

/// Flags every thread on one of the user's links that has a PDF, image or
/// document attachment, one statement per link. Returns the number of threads
/// updated.
pub async fn process_macro_id(pool: &sqlx::PgPool, macro_id: &str) -> anyhow::Result<u64> {
    let link_ids: Vec<Uuid> =
        sqlx::query_scalar!("SELECT id FROM email_links WHERE macro_id = $1", macro_id)
            .fetch_all(pool)
            .await?;

    if link_ids.is_empty() {
        println!("No email links found for {macro_id}.");
        return Ok(0);
    }

    let mut total_flagged = 0u64;
    for link_id in link_ids {
        let flagged = backfill_link_attachment_kind_flags(pool, link_id).await?;

        // Prefix with the user so interleaved concurrent output stays readable.
        println!("[{macro_id}] link {link_id}: flagged {flagged} threads");
        total_flagged += flagged;
    }

    Ok(total_flagged)
}

/// Walks `email_attachments` from `config.start_block`, one short transaction
/// per batch. Prints the block to resume at, and stops there if a batch keeps
/// failing.
pub async fn run_pass(pool: &sqlx::PgPool, config: &Config) -> anyhow::Result<()> {
    let end = email_attachments_block_count(pool).await?;
    println!(
        "Walking {end} blocks of email_attachments from block {}, {} per batch",
        config.start_block, config.blocks_per_batch
    );

    let mut missing = 0;
    let mut flagged = 0;
    let mut first = config.start_block;
    let mut batches = 0u64;
    while first < end {
        let next = (first + config.blocks_per_batch).min(end);
        let batch = run_batch(pool, first, next)
            .await
            .with_context(|| format!("stopped; resume with START_BLOCK={first}"))?;
        missing += batch.missing;
        flagged += batch.flagged;
        first = next;
        batches += 1;

        if batches % PROGRESS_EVERY == 0 || first >= end {
            println!(
                "block {first} of {end}: flagged {flagged} threads so far, \
                 {} left for a rerun; resume with START_BLOCK={first}",
                missing - flagged
            );
        }
        tokio::time::sleep(config.pause).await;
    }

    let left = missing - flagged;
    println!("\n=== Flagged {flagged} threads, {left} left for a rerun ===");
    if left > 0 {
        println!(
            "{left} threads were being written by mail sync or another session; \
             run again to pick them up."
        );
    }
    Ok(())
}

/// Runs one batch of blocks, splitting it whenever a part hits the statement
/// timeout, down to a single block.
async fn run_batch(
    pool: &sqlx::PgPool,
    first_block: i64,
    end_block: i64,
) -> anyhow::Result<AttachmentFlagBatch> {
    let mut total = AttachmentFlagBatch {
        missing: 0,
        flagged: 0,
    };
    let mut ranges = vec![(first_block, end_block)];
    while let Some((first, end)) = ranges.pop() {
        match run_range(pool, first, end).await {
            Ok(batch) => {
                total.missing += batch.missing;
                total.flagged += batch.flagged;
            }
            Err(error) if is_statement_timeout(&error) && end - first > 1 => {
                let middle = first + (end - first) / 2;
                println!("blocks {first}..{end} timed out; trying {first}..{middle} first");
                ranges.push((middle, end));
                ranges.push((first, middle));
            }
            Err(error) => return Err(error),
        }
    }
    Ok(total)
}

/// Runs one block range, again after a short wait when it fails: a lock
/// timeout, a deadlock or a dropped connection clears on its own, and a batch
/// that fails part way commits nothing.
async fn run_range(
    pool: &sqlx::PgPool,
    first_block: i64,
    end_block: i64,
) -> anyhow::Result<AttachmentFlagBatch> {
    let mut tries = 1;
    loop {
        match backfill_attachment_kind_flags_in_blocks(pool, first_block, end_block).await {
            Ok(batch) => return Ok(batch),
            Err(error) if tries < BATCH_TRIES && !is_statement_timeout(&error) => {
                let wait = Duration::from_secs(1 << tries);
                println!(
                    "blocks {first_block}..{end_block} failed ({error:#}); \
                     trying again in {wait:?}"
                );
                tokio::time::sleep(wait).await;
                tries += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

fn is_statement_timeout(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<sqlx::Error>()
            .and_then(sqlx::Error::as_database_error)
            .and_then(|database| database.code())
            .is_some_and(|code| code == STATEMENT_TIMEOUT)
    })
}
