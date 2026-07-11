use anyhow::Context;
use rand::Rng;
use rand::seq::SliceRandom;

/// Creates an account merge request
/// This will return the code for the account merge request
#[tracing::instrument(skip(db))]
pub async fn create_account_merge_request(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_user_id: &str,
    to_merge_macro_user_id: &str,
) -> anyhow::Result<String> {
    let id = macro_uuid::generate_uuid_v7();
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)
        .context("failed to convert macro_user_id to uuid")?;
    let to_merge_macro_user_id = macro_uuid::string_to_uuid(to_merge_macro_user_id)
        .context("failed to convert to_merge_macro_user_id to uuid")?;

    let code = generate_code(6);

    let code = sqlx::query!(
        r#"
        INSERT INTO "account_merge_request" (id, macro_user_id, to_merge_macro_user_id, code, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING "code"
        "#,
        &id,
        &macro_user_id,
        &to_merge_macro_user_id,
        &code
    ).map(|row| row.code).fetch_one(db).await?;

    Ok(code)
}

/// Generates a numeric code of n characters
fn generate_code(code_len: usize) -> String {
    const CHARSET_NUMBERS: &[u8] = b"0123456789";

    let mut rng = rand::rng();
    let mut password = String::with_capacity(20);

    // Fill the remaining 16 characters
    for _ in 0..code_len {
        let idx = rng.random_range(0..CHARSET_NUMBERS.len());
        password.push(CHARSET_NUMBERS[idx] as char);
    }

    // Shuffle the entire password to avoid predictable character positions
    let mut password_chars: Vec<char> = password.chars().collect();
    password_chars.shuffle(&mut rng);

    password_chars.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_code() {
        let code = generate_code(8);
        assert_eq!(code.len(), 8);
    }
}
