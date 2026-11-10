use super::*;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_confirm_begin_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_confirm_begin_primary",
        62060,
        false,
        Fault::ConfirmBegin,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_confirm_begin_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_confirm_begin_retry",
        62063,
        true,
        Fault::ConfirmBegin,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_confirm_threads_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_confirm_threads_primary",
        62066,
        false,
        Fault::ConfirmThreads,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_confirm_threads_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_confirm_threads_retry",
        62069,
        true,
        Fault::ConfirmThreads,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_confirm_lock_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_confirm_lock_primary",
        62072,
        false,
        Fault::ConfirmLock,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_confirm_lock_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_confirm_lock_retry",
        62075,
        true,
        Fault::ConfirmLock,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_confirm_write_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_confirm_write_primary",
        62078,
        false,
        Fault::ConfirmWrite,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_confirm_write_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_confirm_write_retry",
        62081,
        true,
        Fault::ConfirmWrite,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_confirm_commit_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_confirm_commit_primary",
        62084,
        false,
        Fault::ConfirmCommit,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_confirm_commit_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_confirm_commit_retry",
        62087,
        true,
        Fault::ConfirmCommit,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_abandon_begin_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_abandon_begin_primary",
        62090,
        false,
        Fault::AbandonBegin,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_abandon_begin_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_abandon_begin_retry",
        62093,
        true,
        Fault::AbandonBegin,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_abandon_threads_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_abandon_threads_primary",
        62096,
        false,
        Fault::AbandonThreads,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_abandon_threads_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_abandon_threads_retry",
        62099,
        true,
        Fault::AbandonThreads,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_abandon_lock_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_abandon_lock_primary",
        62102,
        false,
        Fault::AbandonLock,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_abandon_lock_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_abandon_lock_retry",
        62105,
        true,
        Fault::AbandonLock,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_abandon_write_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_abandon_write_primary",
        62108,
        false,
        Fault::AbandonWrite,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_abandon_write_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_abandon_write_retry",
        62111,
        true,
        Fault::AbandonWrite,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_abandon_commit_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_abandon_commit_primary",
        62114,
        false,
        Fault::AbandonCommit,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_abandon_commit_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_abandon_commit_retry",
        62117,
        true,
        Fault::AbandonCommit,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_begin_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_begin_primary",
        62120,
        false,
        Fault::RevertBegin,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_begin_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_begin_retry",
        62123,
        true,
        Fault::RevertBegin,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_threads_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_threads_primary",
        62126,
        false,
        Fault::RevertThreads,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_threads_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_threads_retry",
        62129,
        true,
        Fault::RevertThreads,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_lock_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_lock_primary",
        62132,
        false,
        Fault::RevertLock,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_lock_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_lock_retry",
        62135,
        true,
        Fault::RevertLock,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_write_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_write_primary",
        62138,
        false,
        Fault::RevertWrite,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_write_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_write_retry",
        62141,
        true,
        Fault::RevertWrite,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_insert_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_insert_primary",
        62144,
        false,
        Fault::RevertInsert,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_insert_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_insert_retry",
        62147,
        true,
        Fault::RevertInsert,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_delete_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_delete_primary",
        62150,
        false,
        Fault::RevertDelete,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_delete_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_delete_retry",
        62153,
        true,
        Fault::RevertDelete,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_flags_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_flags_primary",
        62156,
        false,
        Fault::RevertFlags,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_flags_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_flags_retry",
        62159,
        true,
        Fault::RevertFlags,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_received_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_received_primary",
        62162,
        false,
        Fault::RevertReceived,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_received_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_received_retry",
        62165,
        true,
        Fault::RevertReceived,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_metadata_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_metadata_primary",
        62168,
        false,
        Fault::RevertMetadata,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_metadata_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_metadata_retry",
        62171,
        true,
        Fault::RevertMetadata,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_signal_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_signal_primary",
        62174,
        false,
        Fault::RevertSignal,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_signal_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_signal_retry",
        62177,
        true,
        Fault::RevertSignal,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_commit_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_commit_primary",
        62180,
        false,
        Fault::RevertCommit,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_revert_commit_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_revert_commit_retry",
        62183,
        true,
        Fault::RevertCommit,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_legacy_insert_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_legacy_insert_primary",
        62186,
        false,
        Fault::LegacyInsert,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_legacy_insert_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_legacy_insert_retry",
        62189,
        true,
        Fault::LegacyInsert,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_legacy_delete_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_legacy_delete_primary",
        62192,
        false,
        Fault::LegacyDelete,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_legacy_delete_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_legacy_delete_retry",
        62195,
        true,
        Fault::LegacyDelete,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_legacy_read_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_legacy_read_primary",
        62198,
        false,
        Fault::LegacyRead,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_legacy_read_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_legacy_read_retry",
        62201,
        true,
        Fault::LegacyRead,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_legacy_starred_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_legacy_starred_primary",
        62204,
        false,
        Fault::LegacyStarred,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_legacy_starred_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_legacy_starred_retry",
        62207,
        true,
        Fault::LegacyStarred,
    )
    .await;
}
