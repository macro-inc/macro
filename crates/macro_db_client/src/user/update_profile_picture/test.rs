use super::*;

#[sqlx::test]
async fn batch_reads_face_without_png_and_photo_upload_clears_it(pool: sqlx::PgPool) {
    let id = uuid::Uuid::now_v7();
    let user_id = "macro|avatar@example.com";
    let face = serde_json::json!({"v": 1, "seed": "portrait", "pins": {"hair": 2}});
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'avatar@example.com', 'avatar@example.com', 'cus_avatar')",
        id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'avatar@example.com', $2)"#,
        user_id,
        id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO macro_user_info (macro_user_id, avatar_face) VALUES ($1, $2)",
        id,
        face,
    )
    .execute(&pool)
    .await
    .unwrap();

    let ids = vec![user_id.to_owned()];
    let pictures = get_profile_pictures(&pool, &ids).await.unwrap().pictures;
    assert_eq!(pictures.len(), 1);
    assert_eq!(pictures[0].url, None);
    assert_eq!(
        pictures[0].avatar_face,
        Some(serde_json::from_value(face).unwrap())
    );

    // The upload helpers receive the macro user's UUID, not the public account id.
    update_profile_picture(
        &pool,
        &id.to_string(),
        "https://static.example/photo.png",
        "photo-hash",
    )
    .await
    .unwrap();
    let pictures = get_profile_pictures(&pool, &ids).await.unwrap().pictures;
    assert_eq!(pictures.len(), 1);
    assert_eq!(pictures[0].avatar_face, None);
    assert_eq!(
        pictures[0].url.as_deref(),
        Some("https://static.example/photo.png")
    );
    assert_eq!(pictures[0].checksum.as_deref(), Some("photo-hash"));
}
