use model::user::{AvatarFace, ProfilePictures, UserProfilePicture};

#[cfg(test)]
mod test;

#[tracing::instrument(skip_all, err)]
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
            profile_picture_hash = EXCLUDED.profile_picture_hash,
            avatar_face = NULL
    "#,
        macro_user_id,
        picture,
        checksum
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Given a list of user profile ids (from "Users" table), return a list of profile pictures
#[tracing::instrument(skip_all, fields(count = user_profile_ids_list.len()), err)]
pub async fn get_profile_pictures(
    db: &sqlx::PgPool,
    user_profile_ids_list: &Vec<String>,
) -> anyhow::Result<ProfilePictures> {
    if user_profile_ids_list.is_empty() {
        return Ok(ProfilePictures::default());
    }

    let rows = sqlx::query!(
        r#"
        SELECT u.id, info.profile_picture, info.profile_picture_hash, info.avatar_face
        FROM "User" u
        JOIN macro_user_info info ON info.macro_user_id = u.macro_user_id
        WHERE u.id = ANY($1)
          AND (info.profile_picture IS NOT NULL OR info.avatar_face IS NOT NULL)
        "#,
        user_profile_ids_list,
    )
    .fetch_all(db)
    .await?;

    let pictures = rows
        .into_iter()
        .map(|row| UserProfilePicture {
            id: row.id,
            url: row.profile_picture,
            checksum: row.profile_picture_hash,
            // A malformed legacy recipe must not fail the batch for everyone else.
            avatar_face: row
                .avatar_face
                .and_then(|json| serde_json::from_value::<AvatarFace>(json).ok())
                .filter(AvatarFace::is_valid),
        })
        .collect();

    Ok(ProfilePictures { pictures })
}
