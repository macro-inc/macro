use super::*;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_decode_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(pool, "fault_decode_primary", 62000, false, Fault::Decode).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_decode_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(pool, "fault_decode_retry", 62003, true, Fault::Decode).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_unknown_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(pool, "fault_unknown_primary", 62006, false, Fault::Unknown).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_unknown_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(pool, "fault_unknown_retry", 62009, true, Fault::Unknown).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_missing_body_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_missing_body_primary",
        62012,
        false,
        Fault::MissingBody,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_missing_body_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_missing_body_retry",
        62015,
        true,
        Fault::MissingBody,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_missing_link_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_missing_link_primary",
        62018,
        false,
        Fault::MissingLink,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_missing_link_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_missing_link_retry",
        62021,
        true,
        Fault::MissingLink,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_missing_receipt_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_missing_receipt_primary",
        62024,
        false,
        Fault::MissingReceipt,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_missing_receipt_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_missing_receipt_retry",
        62027,
        true,
        Fault::MissingReceipt,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_delete_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(pool, "fault_delete_primary", 62030, false, Fault::Delete).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_delete_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(pool, "fault_delete_retry", 62033, true, Fault::Delete).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_decode_and_delete_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_decode_and_delete_primary",
        62036,
        false,
        Fault::DecodeAndDelete,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_decode_and_delete_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_decode_and_delete_retry",
        62039,
        true,
        Fault::DecodeAndDelete,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_retry_queue_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_retry_queue_primary",
        62042,
        false,
        Fault::RetryQueue,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_retry_queue_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_retry_queue_retry",
        62045,
        true,
        Fault::RetryQueue,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_link_query_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_link_query_primary",
        62048,
        false,
        Fault::LinkQuery,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_link_query_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_link_query_retry",
        62051,
        true,
        Fault::LinkQuery,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_turn_query_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_turn_query_primary",
        62054,
        false,
        Fault::TurnQuery,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_turn_query_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_turn_query_retry",
        62057,
        true,
        Fault::TurnQuery,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_token_query_primary(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_token_query_primary",
        62220,
        false,
        Fault::TokenQuery,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fault_token_query_retry(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    fault(
        pool,
        "fault_token_query_retry",
        62223,
        true,
        Fault::TokenQuery,
    )
    .await;
}
