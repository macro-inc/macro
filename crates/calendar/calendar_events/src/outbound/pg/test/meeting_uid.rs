use super::*;
use crate::domain::ics::CalendarEventExportAccess;

/// The UID Exchange gives a meeting it imports from an invitation carrying
/// `uid`: a GlobalObjectId whose data wraps `uid` after "vCal-Uid".
pub(super) fn exchange_uid(uid: &str) -> String {
    let mut data = b"vCal-Uid".to_vec();
    data.extend_from_slice(&[1, 0, 0, 0]);
    data.extend_from_slice(uid.as_bytes());
    data.push(0);
    let size = u32::try_from(data.len()).unwrap().to_le_bytes();
    let hex = |bytes: &[u8]| {
        bytes
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect::<String>()
    };
    format!(
        "040000008200E00074C5B7101A82E008{}{}{}",
        "00".repeat(20),
        hex(&size),
        hex(&data)
    )
}

async fn meeting_uid(pool: &PgPool, uid: &str) -> String {
    sqlx::query_scalar!(r#"SELECT calendar_meeting_uid($1) AS "uid!""#, uid)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_meeting_uid_unwraps_only_an_imported_exchange_uid(pool: PgPool) {
    // As Graph reported it on dev for a Google meeting.
    assert_eq!(
        meeting_uid(
            &pool,
            "040000008200E00074C5B7101A82E0080000000000000000000000000000000000000000320000007643616C2D55696401000000736A696236727237306F3535397269336633336F6D373662386F40676F6F676C652E636F6D00",
        )
        .await,
        "sjib6rr70o559ri3f33om76b8o@google.com"
    );
    assert_eq!(
        meeting_uid(&pool, &exchange_uid("weekly@google.com").to_lowercase()).await,
        "weekly@google.com"
    );
    // A meeting Exchange organized wraps no foreign UID, so its UID stays.
    let native = "040000008200E00074C5B7101A82E00800000000E0F2A5D1C3E9DA01000000000000000010000000F9DC1CC4E5A0EB4DA9F5C4E7BBA0CDB2";
    assert_eq!(meeting_uid(&pool, native).await, native);
    assert_eq!(
        meeting_uid(&pool, "weekly@google.com").await,
        "weekly@google.com"
    );
    // A wrapped UID that is not printable ASCII, or that the escape encoding
    // would not reproduce exactly, is left alone.
    let backslash = exchange_uid("a\\b@example.com");
    assert_eq!(meeting_uid(&pool, &backslash).await, backslash);
    let delete = exchange_uid("a\x7Fb@example.com");
    assert_eq!(meeting_uid(&pool, &delete).await, delete);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_outlook_copy_pairs_with_the_meetings_google_copies(pool: PgPool) {
    let author_id = "macro|uid-author@example.com";
    let viewer_id = "macro|uid-viewer@example.com";
    let author_link = insert_link(&pool, author_id).await;
    let google_link = insert_link(&pool, viewer_id).await;
    let outlook_link = insert_link(&pool, viewer_id).await;
    let repo = PgCalendarRepository::new(pool.clone());

    let authored = timed_upsert(
        author_id,
        author_link,
        provider_ids(&repo, author_link).await,
        "pairing@google.com",
        "Planning",
        1,
    );
    let authored_id = authored.event.id;
    repo.upsert_event_fixture(authored).await.unwrap();
    let google_copy = timed_upsert(
        viewer_id,
        google_link,
        provider_ids(&repo, google_link).await,
        "pairing@google.com",
        "Planning",
        1,
    );
    let google_id = google_copy.event.id;
    repo.upsert_event_fixture(google_copy).await.unwrap();
    let outlook_copy = timed_upsert(
        viewer_id,
        outlook_link,
        provider_ids(&repo, outlook_link).await,
        &exchange_uid("pairing@google.com"),
        "Planning",
        1,
    );
    let outlook_id = outlook_copy.event.id;
    repo.upsert_event_fixture(outlook_copy).await.unwrap();

    let mut copies: Vec<Uuid> = repo
        .meeting_copies(viewer_id, outlook_id)
        .await
        .unwrap()
        .into_iter()
        .map(|copy| copy.event_id)
        .collect();
    copies.sort();
    let mut expected = vec![google_id, outlook_id];
    expected.sort();
    assert_eq!(copies, expected);

    // Someone holding only an Outlook copy of the author's Google meeting
    // sees it as their own: the mention and the export resolve to that copy.
    let outlook_only_id = "macro|uid-outlook-only@example.com";
    let outlook_only_link = insert_link(&pool, outlook_only_id).await;
    let lone_copy = timed_upsert(
        outlook_only_id,
        outlook_only_link,
        provider_ids(&repo, outlook_only_link).await,
        &exchange_uid("pairing@google.com"),
        "Planning",
        1,
    );
    let lone_id = lone_copy.event.id;
    repo.upsert_event_fixture(lone_copy).await.unwrap();
    let previews = repo
        .mention_previews(
            outlook_only_id,
            vec![CalendarMentionRequestItem {
                event_id: authored_id,
                occurrence_key: None,
            }],
            Utc.with_ymd_and_hms(2026, 7, 23, 0, 0, 0).unwrap(),
        )
        .await
        .unwrap();
    let CalendarMentionPreview::Accessible(preview) = &previews[0] else {
        panic!("an Outlook copy is the viewer's own: {:?}", previews[0]);
    };
    assert_eq!(preview.viewer_event_id, Some(lone_id));
    let export = repo
        .event_export(outlook_only_id, authored_id)
        .await
        .unwrap()
        .expect("an Outlook copy is the viewer's own");
    assert_eq!(export.access, CalendarEventExportAccess::OwnCopy);
    assert_eq!(export.owner_id, outlook_only_id);
    assert_eq!(export.ical_uid, "pairing@google.com");
}
