//! Database setup for the eval: inserting task documents (and, where a
//! measurement needs isolation, the owning users).

use std::collections::HashMap;

use sqlx::PgPool;
use task_dedup::eval::EvalCorpus;

/// User the shared-owner corpus is seeded under. The `documents_test_data`
/// fixture creates this user, and `Document.owner` is a foreign key to it.
/// Seeding everything under one owner makes all tasks mutually visible to the
/// owner-scoped search without needing team rows.
pub const EVAL_OWNER: &str = "macro|user@user.com";

/// Inserts every corpus task as a task document owned by [`EVAL_OWNER`], under
/// its seeded document id. Does not embed anything — each measurement embeds as
/// it needs to.
pub async fn seed_documents(pool: &PgPool, corpus: &EvalCorpus, ids: &HashMap<String, String>) {
    for task in &corpus.tasks {
        insert_task_document(pool, &ids[&task.id], &task.title, EVAL_OWNER).await;
    }
}

/// Deletes every persisted duplicate match. The end-to-end eval calls this
/// between pairs so each pair's decision is scored in isolation, while retrieval
/// still runs against the whole seeded corpus (matches are the only shared state
/// `detect_new_task` writes; the embeddings and documents stay put).
pub async fn reset_matches(pool: &PgPool) {
    sqlx::query!("DELETE FROM task_duplicate_match")
        .execute(pool)
        .await
        .expect("reset matches");
}

/// Inserts a single task document (`Document` row + `document_sub_type` marker).
async fn insert_task_document(pool: &PgPool, id: &str, title: &str, owner: &str) {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, "fileType", owner) VALUES ($1, $2, 'md', $3)"#,
        id,
        title,
        owner,
    )
    .execute(pool)
    .await
    .expect("insert document");

    sqlx::query!(
        r#"INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')"#,
        id,
    )
    .execute(pool)
    .await
    .expect("insert document_sub_type");
}
