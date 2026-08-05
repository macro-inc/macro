use super::*;
use calendar_events::domain::models::GOOGLE_CALENDAR_SCOPE;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::gmail::MessagePartBody;
use sqlx::PgPool;

async fn insert_email_link(pool: &PgPool) -> Uuid {
    let link_id = Uuid::now_v7();
    let email_address = format!("calendar-ingest-{link_id}@example.com");
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        "macro|calendar-ingest@example.com",
        email_address,
    )
    .execute(pool)
    .await
    .unwrap();
    link_id
}

async fn set_granted_scopes(pool: &PgPool, link_id: Uuid, scopes: &[&str]) {
    let scopes: Vec<String> = scopes.iter().map(|scope| (*scope).to_owned()).collect();
    sqlx::query!(
        "INSERT INTO email_link_google_scopes (link_id, granted_scopes) VALUES ($1, $2)",
        link_id,
        &scopes,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_scope_row_has_no_calendar_capability(pool: PgPool) {
    let link_id = insert_email_link(&pool).await;

    assert!(!has_calendar_capability(&pool, link_id).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn gmail_only_grant_has_no_calendar_capability(pool: PgPool) {
    let link_id = insert_email_link(&pool).await;
    set_granted_scopes(
        &pool,
        link_id,
        &["https://www.googleapis.com/auth/gmail.modify"],
    )
    .await;

    assert!(!has_calendar_capability(&pool, link_id).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn calendar_grant_has_calendar_capability(pool: PgPool) {
    let link_id = insert_email_link(&pool).await;
    set_granted_scopes(
        &pool,
        link_id,
        &[
            "https://www.googleapis.com/auth/gmail.modify",
            GOOGLE_CALENDAR_SCOPE,
        ],
    )
    .await;

    assert!(has_calendar_capability(&pool, link_id).await.unwrap());
}

#[test]
fn discovers_inline_and_attachment_calendar_parts() {
    let root = MessagePart {
        part_id: String::new(),
        mime_type: "multipart/mixed".to_string(),
        filename: String::new(),
        headers: Vec::new(),
        body: None,
        parts: Some(vec![
            MessagePart {
                part_id: "inline".to_string(),
                mime_type: "text/calendar; method=REQUEST".to_string(),
                filename: String::new(),
                headers: Vec::new(),
                body: Some(MessagePartBody {
                    attachment_id: None,
                    size: 10,
                    data_base64: Some("aGVsbG8".to_string()),
                }),
                parts: None,
            },
            MessagePart {
                part_id: "attachment".to_string(),
                mime_type: "application/octet-stream".to_string(),
                filename: "invite.ICS".to_string(),
                headers: Vec::new(),
                body: Some(MessagePartBody {
                    attachment_id: Some("gmail-id".to_string()),
                    size: 10,
                    data_base64: None,
                }),
                parts: None,
            },
        ]),
    };

    let parts = calendar_parts(&root);
    assert_eq!(parts.len(), 2);
    assert!(
        parts
            .iter()
            .any(|part| part.attachment_id == Some("gmail-id"))
    );
}

#[test]
fn accepts_padded_and_unpadded_base64url() {
    assert_eq!(decode_base64url("aGVsbG8").unwrap(), b"hello");
    assert_eq!(decode_base64url("aGVsbG8=").unwrap(), b"hello");
}
