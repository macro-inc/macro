//! Find email attachment documents that lost their links before the
//! released-attachment queue existed, and queue them for its drain.
//!
//! A dry run (the default) writes nothing but the state file: it counts the
//! orphans by why their links went and what the drain would do with them.
//! `--apply` queues them instead, at most `--per-second` a second, holding
//! back while the queue is deeper than `--max-queue-depth`. Progress is saved
//! to `--state-file` after every page; a rerun with the same file resumes
//! after its cursor, and `--after` starts elsewhere with fresh counts. Any
//! error stops the scan with the last cursor printed. See this crate's
//! `AGENTS.md` before running it against production.

use clap::Parser;
use documents::domain::released_attachments::QUEUE_DEPTH_CAP;
use documents::domain::released_attachments::orphans::{
    DEFAULT_MAX_QUEUE_DEPTH, DEFAULT_PAGE_SIZE, DEFAULT_PER_SECOND, MAX_PAGE_SIZE,
    OrphanedAttachmentScan, ScanOptions, ScanProgress, ScanProgressStore as _,
};
use documents::outbound::pg_released_attachments::PgReleasedAttachmentRepo;
use documents::outbound::scan_state_file::ScanStateFile;
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_vars;
use rootcause::prelude::{Report, ResultExt as _};
use sqlx::postgres::PgPoolOptions;
use std::num::NonZeroU32;
use std::path::PathBuf;

env_vars! {
    struct DatabaseUrl;
}

/// Queue email attachment documents whose mail went before the
/// released-attachment queue existed.
#[derive(Debug, Parser)]
#[command(version, about)]
struct Args {
    /// Queue the orphans for the drain. Omit for a dry run.
    #[arg(long)]
    apply: bool,

    /// JSON file the cursor and counts are saved to after every page, and
    /// resumed from. A file belongs to one mode: dry run or --apply.
    #[arg(long)]
    state_file: PathBuf,

    /// Start after this entity id instead of the state file's cursor, with
    /// fresh counts.
    #[arg(long)]
    after: Option<String>,

    /// Property rows read per page, at most 2,000.
    #[arg(long, default_value_t = DEFAULT_PAGE_SIZE)]
    page_size: NonZeroU32,

    /// Most orphans queued per second.
    #[arg(long, default_value_t = DEFAULT_PER_SECOND)]
    per_second: NonZeroU32,

    /// Wait while more documents than this wait in the queue.
    #[arg(long, default_value_t = DEFAULT_MAX_QUEUE_DEPTH)]
    max_queue_depth: u32,
}

#[tokio::main]
async fn main() -> Result<(), Report> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run(Args::parse()).await;
    entrypoint.shutdown();
    result
}

async fn run(args: Args) -> Result<(), Report> {
    if i64::from(args.max_queue_depth) >= QUEUE_DEPTH_CAP {
        rootcause::bail!(
            "--max-queue-depth must be under {QUEUE_DEPTH_CAP}, which the depth is counted up to"
        );
    }
    if args.page_size.get() > MAX_PAGE_SIZE {
        rootcause::bail!("--page-size must be at most {MAX_PAGE_SIZE}");
    }
    let options = ScanOptions {
        page_size: args.page_size,
        per_second: args.per_second,
        max_queue_depth: args.max_queue_depth,
    };

    let state_file = ScanStateFile::new(args.state_file.clone());
    let saved = state_file.load()?;
    if let Some(saved) = &saved
        && saved.apply != args.apply
    {
        rootcause::bail!(
            "{} holds a {} scan; use another --state-file for this one",
            args.state_file.display(),
            mode(saved.apply)
        );
    }
    let progress = match (args.after, saved) {
        (Some(after), _) => {
            // Saved before any page is read, so a rerun after a failed first
            // page resumes this restart rather than what the file held.
            let restart = ScanProgress::start(args.apply, Some(after));
            state_file.save(&restart).await?;
            restart
        }
        (None, Some(saved)) => saved,
        (None, None) => ScanProgress::start(args.apply, None),
    };
    if progress.finished {
        println!(
            "{} records a finished {} scan; nothing to do.",
            args.state_file.display(),
            mode(progress.apply)
        );
        print_summary(&progress);
        return Ok(());
    }

    tracing::info!(
        apply = progress.apply,
        after = progress.after.as_deref().unwrap_or(""),
        page_size = options.page_size.get(),
        per_second = options.per_second.get(),
        max_queue_depth = options.max_queue_depth,
        "starting orphaned attachment scan"
    );
    if !progress.apply {
        tracing::warn!("dry run: pass --apply to queue the orphans for the drain");
    }

    let database_url = DatabaseUrl::new()?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url.as_ref())
        .await
        .context("could not connect to the database")?;
    let scan = OrphanedAttachmentScan::new(PgReleasedAttachmentRepo::new(pool), state_file);

    match scan.run(options, progress).await {
        Ok(done) => {
            print_summary(&done);
            Ok(())
        }
        Err(stopped) => {
            print_summary(&stopped.progress);
            println!(
                "Stopped. Rerun with the same --state-file to resume after {:?}.",
                stopped.progress.after.as_deref().unwrap_or("")
            );
            Err(stopped.error)
        }
    }
}

fn mode(apply: bool) -> &'static str {
    if apply { "--apply" } else { "dry-run" }
}

fn print_summary(progress: &ScanProgress) {
    let counts = &progress.counts;
    println!(
        "\nOrphaned email attachment scan ({})",
        mode(progress.apply)
    );
    println!("  after: {:?}", progress.after.as_deref().unwrap_or(""));
    println!("  pages: {}", progress.pages);
    println!("  finished: {}", progress.finished);
    println!(
        "  source_not_from_import: {}",
        counts.source_not_from_import
    );
    println!("  orphans: {}", counts.orphans);
    println!("    mailbox_gone: {}", counts.mailbox_gone);
    println!("    mailbox_recreated: {}", counts.mailbox_recreated);
    println!("    thread_gone: {}", counts.thread_gone);
    println!("    message_gone: {}", counts.message_gone);
    println!("    attachment_replaced: {}", counts.attachment_replaced);
    if progress.apply {
        println!("  enqueued: {}", counts.enqueued);
        println!("  already_queued: {}", counts.already_queued);
    } else {
        println!("  would_trash: {}", counts.would_trash);
        println!("  would_keep_adopted: {}", counts.would_keep_adopted);
        println!("  would_keep_in_trash: {}", counts.would_keep_in_trash);
        println!("  would_skip: {}", counts.would_skip);
    }
}
