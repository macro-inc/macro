use super::*;
use crate::domain::invitations::{
    CalendarInvitationResolver, InvitationIdentity, InvitationResolution,
};

fn identity(link: Uuid) -> InvitationIdentity {
    InvitationIdentity {
        id: "snapshot".into(),
        uid: "invite-uid".into(),
        preferred_link_id: link,
        occurrence_key: None,
        unresolved_instance: false,
        related_revisions: Vec::new(),
        series_revisions: Vec::new(),
        cancelled: false,
        organizer_email: Some("organizer@example.com".into()),
        last_modified: None,
        sequence: 1,
    }
}
async fn event(pool: &PgPool, repo: &PgCalendarRepository, viewer: &str, link: Uuid) -> Uuid {
    persist_complete_grant(pool, link, 1).await;
    let provider = provider_ids(repo, link).await;
    let mut upsert = timed_upsert(viewer, link, provider, "invite-uid", "Review", 1);
    upsert.event.is_read_only = false;
    upsert.event.recurrence_lines.clear();
    upsert.occurrences.truncate(1);
    upsert.event.attendees[0].email =
        sqlx::query_scalar!("SELECT email_address FROM email_links WHERE id = $1", link)
            .fetch_one(pool)
            .await
            .unwrap();
    repo.upsert_event_fixture(upsert).await.unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn invitation_accounts_are_authorized_and_ambiguity_never_guesses(pool: PgPool) {
    let viewer = "macro|invite-reader@example.com";
    insert_user(&pool, viewer).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let a = insert_link(&pool, viewer).await;
    let b = insert_link(&pool, viewer).await;
    let event_a = event(&pool, &repo, viewer, a).await;
    event(&pool, &repo, viewer, b).await;
    let resolver = CalendarInvitationResolver(repo);
    let result = resolver
        .resolve(viewer, &[identity(a), identity(Uuid::nil())])
        .await
        .unwrap();
    assert!(
        matches!(&result[0], InvitationResolution::Resolved { event, can_respond: true, .. } if event.id == event_a),
        "{result:?}"
    );
    assert!(matches!(result[1], InvitationResolution::Ambiguous));
    assert!(matches!(
        resolver
            .resolve("macro|unrelated@example.com", &[identity(a)])
            .await
            .unwrap()[0],
        InvitationResolution::Disconnected
    ));
    let mut disconnected_cancel = identity(a);
    disconnected_cancel.cancelled = true;
    assert!(matches!(
        resolver
            .resolve("macro|unrelated@example.com", &[disconnected_cancel])
            .await
            .unwrap()[0],
        InvitationResolution::Cancelled
    ));
    let mut shared = identity(Uuid::nil());
    shared
        .related_revisions
        .push(crate::domain::invitations::InvitationRevision {
            link_id: a,
            sequence: 2,
            last_modified: None,
            cancelled: true,
        });
    assert!(matches!(
        resolver.resolve(viewer, &[shared]).await.unwrap()[0],
        InvitationResolution::Cancelled
    ));
    let mut unresolved = identity(a);
    unresolved.unresolved_instance = true;
    assert!(matches!(
        resolver.resolve(viewer, &[unresolved]).await.unwrap()[0],
        InvitationResolution::Unavailable
    ));
    let mut cancelled = identity(a);
    cancelled.cancelled = true;
    assert!(matches!(
        resolver.resolve(viewer, &[cancelled]).await.unwrap()[0],
        InvitationResolution::Resolved {
            can_respond: false,
            is_stale: true,
            ..
        }
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn invitation_moved_instance_uses_original_key_and_instance_revision(pool: PgPool) {
    let viewer = "macro|instance-reader@example.com";
    insert_user(&pool, viewer).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let link = insert_link(&pool, viewer).await;
    persist_complete_grant(&pool, link, 1).await;
    let provider = provider_ids(&repo, link).await;
    let mut upsert = timed_upsert(viewer, link, provider, "invite-uid", "Review", 1);
    let original = upsert.occurrences[1].occurrence_key.clone();
    let original_time = EventStart::Timed(Utc.with_ymd_and_hms(2026, 7, 25, 14, 0, 0).unwrap());
    let moved = EventTime::Timed {
        starts_at: Utc.with_ymd_and_hms(2026, 7, 27, 14, 0, 0).unwrap(),
        ends_at: Utc.with_ymd_and_hms(2026, 7, 27, 15, 0, 0).unwrap(),
        time_zone: None,
    };
    upsert.overrides.push(CalendarEventOverride {
        sequence: Some(8),
        source_updated_at: Some(Utc::now()),
        recurrence_id: original.clone(),
        original_time,
        time: moved.clone(),
        title: None,
        description: None,
        location: None,
        status: None,
        attendees: None,
    });
    upsert.occurrences[1].time = moved.clone();
    upsert.occurrences[1].recurrence_id = Some(original.clone());
    repo.upsert_event_fixture(upsert).await.unwrap();
    let mut request = identity(link);
    request.occurrence_key = Some(original.clone());
    request.sequence = 8;
    let resolver = CalendarInvitationResolver(repo);
    let result = resolver
        .resolve(viewer, &[identity(link), request.clone()])
        .await
        .unwrap();
    assert!(
        matches!(&result[0], InvitationResolution::Resolved { occurrence, .. } if occurrence.occurrence_key != original)
    );
    assert!(
        matches!(&result[1], InvitationResolution::Resolved { occurrence, event, is_stale: false, .. } if occurrence.occurrence_key == original && occurrence.time == moved && event.sequence == 8),
        "{result:?}"
    );
    request
        .series_revisions
        .push(crate::domain::invitations::InvitationRevision {
            link_id: link,
            sequence: 2,
            last_modified: None,
            cancelled: true,
        });
    assert!(
        matches!(
            resolver.resolve(viewer, &[request.clone()]).await.unwrap()[0],
            InvitationResolution::Cancelled
        ),
        "a master cancellation at 2 supersedes the master at 1 even when the exception is at 8"
    );
    request
        .series_revisions
        .push(crate::domain::invitations::InvitationRevision {
            link_id: link,
            sequence: 3,
            last_modified: None,
            cancelled: false,
        });
    assert!(
        matches!(
            resolver.resolve(viewer, &[request.clone()]).await.unwrap()[0],
            InvitationResolution::Resolved {
                is_stale: true,
                can_respond: false,
                can_join: false,
                ..
            }
        ),
        "a newer master request supersedes the older cancellation in the master stream"
    );
    request.series_revisions = vec![crate::domain::invitations::InvitationRevision {
        link_id: Uuid::now_v7(),
        sequence: 20,
        last_modified: None,
        cancelled: true,
    }];
    assert!(
        matches!(
            resolver.resolve(viewer, &[request]).await.unwrap()[0],
            InvitationResolution::Resolved {
                is_stale: false,
                ..
            }
        ),
        "another inbox's cancellation must not alter the selected calendar copy"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn master_invitation_does_not_compare_revisions_with_first_exception(pool: PgPool) {
    let viewer = "macro|master-reader@example.com";
    insert_user(&pool, viewer).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let link = insert_link(&pool, viewer).await;
    persist_complete_grant(&pool, link, 1).await;
    let provider = provider_ids(&repo, link).await;
    let mut upsert = timed_upsert(viewer, link, provider, "invite-uid", "Review", 1);
    let first = &mut upsert.occurrences[0];
    first.recurrence_id = Some(first.occurrence_key.clone());
    upsert.overrides.push(CalendarEventOverride {
        sequence: Some(8),
        source_updated_at: Some(Utc::now()),
        recurrence_id: first.occurrence_key.clone(),
        original_time: EventStart::Timed(Utc::now()),
        time: first.time.clone(),
        title: None,
        description: None,
        location: None,
        status: None,
        attendees: None,
    });
    repo.upsert_event_fixture(upsert).await.unwrap();
    let resolver = CalendarInvitationResolver(repo);
    let mut cancel = identity(link);
    cancel.sequence = 2;
    cancel.cancelled = true;
    let result = resolver.resolve(viewer, &[cancel.clone()]).await.unwrap();
    assert!(
        matches!(&result[0], InvitationResolution::Resolved { event, can_respond: false, can_join: false, is_stale: true, .. } if event.sequence == 8),
        "{result:?}"
    );
    cancel.cancelled = false;
    cancel.sequence = 3;
    let result = resolver.resolve(viewer, &[cancel]).await.unwrap();
    assert!(
        matches!(
            &result[0],
            InvitationResolution::Resolved {
                can_respond: false,
                can_join: false,
                is_stale: true,
                ..
            }
        ),
        "{result:?}"
    );
}
