use super::*;
use crate::domain::image::GuestImage;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recording_a_new_image_keeps_the_old_one_as_the_rollback_target(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    repo.register_host(HostRegistration {
        name: "image-test-host".to_owned(),
        memory_gb: 31,
        reserve_gb: 7,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    let id = repo.reserve(standard(1), now()).await.unwrap().id;
    let images = |repo: PgComputerRepo| async move {
        let computer = repo.get(id).await.unwrap().unwrap().into_healthy().unwrap();
        (
            computer.image.map(|image| image.as_str().to_owned()),
            computer
                .previous_image
                .map(|image| image.as_str().to_owned()),
        )
    };
    assert_eq!(images(repo.clone()).await, (None, None));

    let base = GuestImage::try_new("macro-box/2026-11-01").unwrap();
    let next = GuestImage::try_new("macro-box/2026-11-10").unwrap();
    repo.record_image(id, &base).await.unwrap();
    assert_eq!(
        images(repo.clone()).await,
        (Some("macro-box/2026-11-01".to_owned()), None)
    );
    repo.record_image(id, &next).await.unwrap();
    // A retried completion records the same image again.
    repo.record_image(id, &next).await.unwrap();
    assert_eq!(
        images(repo.clone()).await,
        (
            Some("macro-box/2026-11-10".to_owned()),
            Some("macro-box/2026-11-01".to_owned())
        )
    );
}
