//! A form's id is its surface's id: the public API never takes one, and a
//! surface whose form is gone is retired.

use super::*;

/// A repo whose forms domain knows `form` (live or trashed alike: the port
/// answers both).
fn knowing_form(form: Uuid) -> Arc<MemRepo> {
    let repo = Arc::new(MemRepo::default());
    repo.form_ids.lock().unwrap().push(form);
    repo
}

#[tokio::test]
async fn a_channel_member_cannot_take_a_form_id_for_a_channel_surface() {
    // The form has never opened its builder, so no surface holds its id yet.
    let form = surface_id();
    let repo = knowing_form(form);
    // The bare mock panics if sync-service is reached.
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());

    let err = svc
        .ensure_surface(
            &user("macro|a@b.c"),
            channel_receipt(),
            form,
            "squatted".to_string(),
        )
        .await
        .unwrap_err();

    assert!(matches!(err, CollabSurfaceError::IdReserved));
    assert!(repo.stored().is_none());
}

#[tokio::test]
async fn a_surface_squatting_a_form_id_is_not_handed_back_to_the_squatter() {
    let form = surface_id();
    let repo = knowing_form(form);
    let mut squat = pending_surface(form);
    squat.state = SurfaceState::Ready;
    *repo.surface.lock().unwrap() = Some(squat);
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());

    let err = svc
        .ensure_surface(&user("macro|a@b.c"), channel_receipt(), form, String::new())
        .await
        .unwrap_err();

    assert!(matches!(err, CollabSurfaceError::IdReserved));
}

#[tokio::test]
async fn an_id_no_form_names_is_free_for_a_channel_surface() {
    let repo = Arc::new(MemRepo::default());
    let id = surface_id();
    let mut init = no_sessions();
    init.expect_initialize()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);

    let surface = svc
        .ensure_surface(&user("macro|a@b.c"), channel_receipt(), id, String::new())
        .await
        .unwrap();

    assert_eq!(surface.state, SurfaceState::Ready);
    assert_eq!(repo.form_lookups.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_form_still_ensures_its_own_surface_under_its_id() {
    let form = surface_id();
    let repo = knowing_form(form);
    let mut init = no_sessions();
    init.expect_initialize_from_snapshot()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let svc = service_with(repo.clone(), init);

    let surface = svc
        .ensure_owned_surface_from_snapshot(form_parent(form), form, vec![1, 2, 3])
        .await
        .unwrap();

    assert_eq!(surface.parent, form_parent(form));
    assert_eq!(surface.state, SurfaceState::Ready);
}

#[tokio::test]
async fn a_surface_whose_form_was_deleted_without_the_forms_domain_is_retired_when_asked_for() {
    // A database, table or owner purge cascaded to the form row; nothing told
    // the forms domain, so its surface was never retired.
    let form = surface_id();
    let repo = MemRepo::holding(ready_form_surface(form));
    // A retired surface keeps its session.
    let mut init = MockSurfaceInitializer::new();
    init.expect_session_exists()
        .returning(|_| Box::pin(async { Ok(true) }));
    let svc = service_with(repo.clone(), init);

    let err = svc.get_parent(form).await.unwrap_err();

    assert!(matches!(err, CollabSurfaceError::NotFound));
    assert!(repo.soft_deleted.load(Ordering::SeqCst));
    // Retired for good: the id never comes back.
    let err = svc
        .ensure_owned_surface_from_snapshot(form_parent(form), form, vec![1])
        .await
        .unwrap_err();
    assert!(matches!(err, CollabSurfaceError::Gone));
}

#[tokio::test]
async fn a_live_or_trashed_form_keeps_its_surface() {
    let form = surface_id();
    let repo = knowing_form(form);
    *repo.surface.lock().unwrap() = Some(ready_form_surface(form));
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());

    assert_eq!(svc.get_parent(form).await.unwrap(), form_parent(form));
    assert!(!repo.soft_deleted.load(Ordering::SeqCst));
}

#[tokio::test]
async fn other_parents_never_ask_the_forms_domain() {
    let id = surface_id();
    let repo = MemRepo::holding(ready_initiative_surface(id));
    let svc = service_with(repo.clone(), MockSurfaceInitializer::new());

    assert_eq!(svc.get_parent(id).await.unwrap(), initiative_parent(id));
    assert_eq!(repo.form_lookups.load(Ordering::SeqCst), 0);
    assert!(!repo.soft_deleted.load(Ordering::SeqCst));
}
