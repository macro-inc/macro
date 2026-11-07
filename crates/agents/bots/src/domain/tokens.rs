//! Bot token generation utilities.

use rand::RngCore;

const TOKEN_SECRET_BYTES: usize = 32;
const TOKEN_PREFIX_BYTES: usize = 6;

/// Generate an `mbot_<prefix>_<secret>` token.
pub fn generate_token() -> String {
    let mut secret = [0_u8; TOKEN_SECRET_BYTES];
    rand::rng().fill_bytes(&mut secret);
    let secret_hex = hex::encode(secret);
    let prefix = &secret_hex[..TOKEN_PREFIX_BYTES * 2];

    format!("mbot_{prefix}_{secret_hex}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_token_has_expected_shape() {
        let token = generate_token();
        let parts: Vec<_> = token.split('_').collect();

        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "mbot");
        assert_eq!(parts[1].len(), TOKEN_PREFIX_BYTES * 2);
        assert_eq!(parts[2].len(), TOKEN_SECRET_BYTES * 2);
        assert!(parts[2].starts_with(parts[1]));
    }

    #[test]
    fn generated_token_is_url_path_safe() {
        let token = generate_token();

        assert!(token.is_ascii());
        assert!(
            token
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        );
        assert!(!token.contains('/'));
        assert!(!token.contains('?'));
        assert!(!token.contains('#'));
    }
}
