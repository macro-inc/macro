use std::collections::HashMap;

use model::user::{ProfilePictures, UserProfilePicture};

#[tracing::instrument(skip(db))]
pub async fn update_profile_picture(
    db: &sqlx::PgPool,
    macro_user_id: &str,
    picture: &str,
    checksum: &str,
) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;

    sqlx::query!(
        r#"
        INSERT INTO macro_user_info (macro_user_id, profile_picture, profile_picture_hash)
        VALUES ($1, $2, $3)
        ON CONFLICT (macro_user_id)
        DO UPDATE SET 
            profile_picture = EXCLUDED.profile_picture,
            profile_picture_hash = EXCLUDED.profile_picture_hash
    "#,
        macro_user_id,
        picture,
        checksum
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Sets the user's profile picture to a photo imported from their Google
/// account, unless they have chosen their own. Returns whether it changed.
///
/// The picture is only written while the user has never set one (`NULL`) or
/// still shows `previous_import`, the photo imported last time, so a changed
/// Google photo follows through but a custom upload is never replaced. Removing
/// a picture stores an empty string, which never matches, so a removal sticks.
#[tracing::instrument(skip(db), err)]
pub async fn import_profile_picture(
    db: &sqlx::PgPool,
    macro_user_id: &str,
    picture: &str,
    previous_import: Option<&str>,
) -> anyhow::Result<bool> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;

    let result = sqlx::query!(
        r#"
        INSERT INTO macro_user_info (macro_user_id, profile_picture)
        VALUES ($1, $2)
        ON CONFLICT (macro_user_id)
        DO UPDATE SET
            profile_picture = EXCLUDED.profile_picture,
            profile_picture_hash = NULL
        WHERE macro_user_info.profile_picture IS DISTINCT FROM EXCLUDED.profile_picture
            AND (
                macro_user_info.profile_picture IS NULL
                OR (macro_user_info.profile_picture <> '' AND macro_user_info.profile_picture = $3)
            )
    "#,
        macro_user_id,
        picture,
        previous_import
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Given a list of user profile ids (from "Users" table), return a list of profile pictures
#[tracing::instrument(skip(db))]
pub async fn get_profile_pictures(
    db: &sqlx::PgPool,
    user_profile_ids_list: &Vec<String>,
) -> anyhow::Result<ProfilePictures> {
    if user_profile_ids_list.is_empty() {
        return Ok(ProfilePictures::default());
    }

    let macro_user_id_list: Vec<(String, uuid::Uuid)> = sqlx::query!(
        r#"
        SELECT 
            u.id as user_profile_id, 
            mu.id as macro_user_id
        FROM macro_user mu
        JOIN "User" u ON mu.id = u.macro_user_id
        WHERE u.id = ANY($1)
        "#,
        user_profile_ids_list
    )
    .map(|row| (row.user_profile_id, row.macro_user_id))
    .fetch_all(db)
    .await?;

    let macro_user_id_list: HashMap<uuid::Uuid, String> = macro_user_id_list
        .into_iter()
        .map(|(id, macro_user_id)| (macro_user_id, id))
        .collect();

    let macro_user_ids: Vec<uuid::Uuid> = macro_user_id_list.keys().copied().collect();

    let pictures: Vec<(uuid::Uuid, String, Option<String>)> = sqlx::query!(
        r#"
        SELECT macro_user_id, profile_picture as "profile_picture!", profile_picture_hash FROM macro_user_info
        WHERE macro_user_id = ANY($1) and profile_picture IS NOT NULL
        "#,
        &macro_user_ids
    )
    .map(|row| (row.macro_user_id, row.profile_picture, row.profile_picture_hash))
    .fetch_all(db)
    .await?;

    let result: Vec<UserProfilePicture> = pictures
        .into_iter()
        .filter_map(|(macro_user_id, url, checksum)| {
            macro_user_id_list
            .get(&macro_user_id)
            .map(|user_id| UserProfilePicture {
                id: user_id.to_string(),
                url,
                checksum,
            })
            .or_else(|| {
                tracing::warn!(macro_user_id=?macro_user_id, "user_id not found for macro_user_id");
                None
            })
        })
        .collect();

    Ok(ProfilePictures { pictures: result })
}

#[cfg(test)]
mod test;
