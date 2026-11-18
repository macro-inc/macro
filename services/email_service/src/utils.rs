/// User IDs are expected to be in the format "macro|email@example.com"
/// Returns the email or an error if the email is invalid
#[tracing::instrument(level = "debug")]
pub fn email_from_user_id(user_id: &str) -> anyhow::Result<String> {
    let email = user_id
        .split_once('|')
        .map(|(_, email)| email.to_string())
        .ok_or_else(|| anyhow::anyhow!("invalid user id format"))?;

    if email.is_empty() {
        anyhow::bail!("empty email in user id");
    }

    Ok(email)
}
