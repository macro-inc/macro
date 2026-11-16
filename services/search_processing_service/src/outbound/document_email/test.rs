use super::*;

#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(path = "../../../fixtures", scripts("email_attachment_documents"))
)]
async fn a_document_is_an_email_attachment_only_while_a_link_exists(pool: PgPool) {
    assert!(is_email_attachment(&pool, "attachment-a").await.unwrap());
    assert!(is_email_attachment(&pool, "attachment-b").await.unwrap());
    assert!(!is_email_attachment(&pool, "plain-d").await.unwrap());
    assert!(
        !is_email_attachment(&pool, "no-such-document")
            .await
            .unwrap()
    );

    sqlx::query!(
        "DELETE FROM document_email WHERE document_id = $1",
        "attachment-b"
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(!is_email_attachment(&pool, "attachment-b").await.unwrap());
}
