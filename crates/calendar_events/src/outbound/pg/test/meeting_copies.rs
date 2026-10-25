use super::*;

async fn link_email(pool: &PgPool, link_id: Uuid) -> String {
    sqlx::query_scalar!(
        "SELECT email_address FROM email_links WHERE id = $1",
        link_id
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// One meeting copied into each inbox it reaches: `organizer` organizes it
/// and `guest` is invited.
fn meeting_copy(
    owner_id: &str,
    link_id: Uuid,
    provider: (Uuid, Uuid),
    organizer: &str,
    guest: &str,
) -> CalendarEventUpsert {
    let mut copy = timed_upsert(
        owner_id,
        link_id,
        provider,
        "copies@example.com",
        "Weekly sync",
        1,
    );
    copy.event.organizer_email = Some(organizer.to_string());
    copy.event.attendees[0].email = guest.to_string();
    copy
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn meeting_copies_list_each_of_the_requesters_inboxes(pool: PgPool) {
    let owner_id = "macro|copies-owner@example.com";
    let other_id = "macro|copies-other@example.com";
    let organizing_link = insert_link(&pool, owner_id).await;
    let invited_link = insert_link(&pool, owner_id).await;
    let cancelled_link = insert_link(&pool, owner_id).await;
    let other_link = insert_link(&pool, other_id).await;
    let organizing_inbox = link_email(&pool, organizing_link).await;
    let invited_inbox = link_email(&pool, invited_link).await;
    let repo = PgCalendarRepository::new(pool.clone());

    let organized = meeting_copy(
        owner_id,
        organizing_link,
        provider_ids(&repo, organizing_link).await,
        &organizing_inbox,
        &invited_inbox,
    );
    let organized_id = organized.event.id;
    repo.upsert_event_fixture(organized).await.unwrap();
    let invited = meeting_copy(
        owner_id,
        invited_link,
        provider_ids(&repo, invited_link).await,
        &organizing_inbox,
        &invited_inbox,
    );
    let invited_id = invited.event.id;
    repo.upsert_event_fixture(invited).await.unwrap();
    let mut cancelled = meeting_copy(
        owner_id,
        cancelled_link,
        provider_ids(&repo, cancelled_link).await,
        &organizing_inbox,
        &invited_inbox,
    );
    cancelled.event.status = EventStatus::Cancelled;
    repo.upsert_event_fixture(cancelled).await.unwrap();
    let others = meeting_copy(
        other_id,
        other_link,
        provider_ids(&repo, other_link).await,
        &organizing_inbox,
        &invited_inbox,
    );
    let others_id = others.event.id;
    repo.upsert_event_fixture(others).await.unwrap();
    let unrelated = timed_upsert(
        owner_id,
        organizing_link,
        provider_ids(&repo, organizing_link).await,
        "unrelated@example.com",
        "Something else",
        1,
    );
    repo.upsert_event_fixture(unrelated).await.unwrap();

    let mut expected = vec![
        MeetingCopy {
            event_id: organized_id,
            inbox: organizing_inbox.clone(),
            organizes: true,
            attends: false,
        },
        MeetingCopy {
            event_id: invited_id,
            inbox: invited_inbox.clone(),
            organizes: false,
            attends: true,
        },
    ];
    expected.sort_by_key(|copy| copy.inbox.to_lowercase());
    // The cancelled copy, the other user's copy and the unrelated meeting
    // are left out, whichever copy the lookup starts from.
    assert_eq!(
        repo.meeting_copies(owner_id, invited_id).await.unwrap(),
        expected
    );
    assert_eq!(
        repo.meeting_copies(owner_id, others_id).await.unwrap(),
        expected
    );
    assert_eq!(
        repo.meeting_copies(other_id, organized_id)
            .await
            .unwrap()
            .into_iter()
            .map(|copy| copy.event_id)
            .collect::<Vec<_>>(),
        vec![others_id]
    );
    assert!(
        repo.meeting_copies(owner_id, Uuid::now_v7())
            .await
            .unwrap()
            .is_empty()
    );
}
