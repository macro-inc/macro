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

#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(path = "../../../fixtures", scripts("email_attachment_documents"))
)]
async fn pages_walk_each_linked_document_once_in_id_order(pool: PgPool) {
    let source = PgLinkedDocuments::new(pool);
    let two = PageSize::try_from(2).unwrap();
    let linked = |document_id: &str, is_live: bool| LinkedDocument {
        document_id: document_id.to_owned(),
        is_live,
    };

    // `attachment-a` has two links but is read once; `plain-d` has none.
    let first = source.page_after(None, two).await.unwrap();
    assert_eq!(
        first,
        vec![linked("attachment-a", true), linked("attachment-b", true)]
    );

    let second = source.page_after(Some("attachment-b"), two).await.unwrap();
    assert_eq!(
        second,
        vec![linked("attachment-c", false), linked("attachment-e", true)]
    );

    let past_the_end = source.page_after(Some("attachment-e"), two).await.unwrap();
    assert!(past_the_end.is_empty(), "{past_the_end:?}");
}
