//! Pairing code, device secret, and harness token generation.

use rand::{Rng, RngCore};

/// Unambiguous, uppercase pairing-code alphabet (no `0/O`, `1/I/L`, `U/V`).
const CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTWXYZ";
/// Pairing-code length, excluding the display hyphen.
const CODE_CHARS: usize = 8;
const TOKEN_SECRET_BYTES: usize = 32;
const TOKEN_PREFIX_BYTES: usize = 6;
const DEVICE_SECRET_BYTES: usize = 32;

/// Generate a pairing code, rendered `XXXX-XXXX`.
pub fn generate_pairing_code() -> String {
    let mut rng = rand::rng();
    let mut code = String::with_capacity(CODE_CHARS + 1);
    for index in 0..CODE_CHARS {
        if index == CODE_CHARS / 2 {
            code.push('-');
        }
        let symbol = CODE_ALPHABET[rng.random_range(0..CODE_ALPHABET.len())];
        code.push(symbol as char);
    }
    code
}

/// Normalize user input to the stored pairing-code form, `XXXX-XXXX`.
///
/// Uppercases and strips separators so `kx7m 4qhd` and `KX7M-4QHD` both
/// resolve. Returns `None` when the residue is not exactly the code length.
pub fn normalize_pairing_code(input: &str) -> Option<String> {
    let symbols: Vec<char> = input
        .chars()
        .filter(|symbol| !symbol.is_whitespace() && *symbol != '-')
        .map(|symbol| symbol.to_ascii_uppercase())
        .collect();
    if symbols.len() != CODE_CHARS {
        return None;
    }

    let mut code = String::with_capacity(CODE_CHARS + 1);
    for (index, symbol) in symbols.into_iter().enumerate() {
        if index == CODE_CHARS / 2 {
            code.push('-');
        }
        code.push(symbol);
    }
    Some(code)
}

/// Generate an `mhns_<prefix>_<secret>` harness bearer token.
pub fn generate_harness_token() -> String {
    let mut secret = [0_u8; TOKEN_SECRET_BYTES];
    rand::rng().fill_bytes(&mut secret);
    let secret_hex = hex::encode(secret);
    let prefix = &secret_hex[..TOKEN_PREFIX_BYTES * 2];

    format!("mhns_{prefix}_{secret_hex}")
}

/// Generate the claim credential the daemon keeps between create and claim.
pub fn generate_device_secret() -> String {
    let mut secret = [0_u8; DEVICE_SECRET_BYTES];
    rand::rng().fill_bytes(&mut secret);
    hex::encode(secret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_code_has_expected_shape() {
        let code = generate_pairing_code();
        assert_eq!(code.len(), CODE_CHARS + 1);
        assert_eq!(code.as_bytes()[CODE_CHARS / 2], b'-');
        assert!(
            code.chars()
                .filter(|symbol| *symbol != '-')
                .all(|symbol| CODE_ALPHABET.contains(&(symbol as u8)))
        );
    }

    #[test]
    fn normalization_accepts_messy_input_and_rejects_wrong_lengths() {
        assert_eq!(
            normalize_pairing_code("kx7m 4qhd").as_deref(),
            Some("KX7M-4QHD")
        );
        assert_eq!(
            normalize_pairing_code("KX7M-4QHD").as_deref(),
            Some("KX7M-4QHD")
        );
        assert_eq!(
            normalize_pairing_code("kx7m4qhd").as_deref(),
            Some("KX7M-4QHD")
        );
        assert!(normalize_pairing_code("short").is_none());
        assert!(normalize_pairing_code("way-too-long-code").is_none());
    }

    #[test]
    fn generated_codes_round_trip_through_normalization() {
        let code = generate_pairing_code();
        assert_eq!(normalize_pairing_code(&code).as_deref(), Some(&*code));
    }

    #[test]
    fn harness_token_has_expected_shape() {
        let token = generate_harness_token();
        let parts: Vec<_> = token.split('_').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "mhns");
        assert_eq!(parts[1].len(), TOKEN_PREFIX_BYTES * 2);
        assert_eq!(parts[2].len(), TOKEN_SECRET_BYTES * 2);
        assert!(parts[2].starts_with(parts[1]));
        assert_eq!(
            harness_token::token_prefix(&token),
            format!("mhns_{}", parts[1])
        );
    }

    #[test]
    fn device_secrets_are_long_and_unique() {
        let first = generate_device_secret();
        let second = generate_device_secret();
        assert_eq!(first.len(), DEVICE_SECRET_BYTES * 2);
        assert_ne!(first, second);
    }
}
