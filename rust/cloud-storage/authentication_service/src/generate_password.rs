use rand::Rng;
use rand::seq::SliceRandom;

/// Generates a random 20 character password
pub fn generate_random_password() -> String {
    const CHARSET_LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
    const CHARSET_UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const CHARSET_NUMBERS: &[u8] = b"0123456789";
    const CHARSET_SPECIAL: &[u8] = b"!@#$%^&*()_+-=[]{}|;:,.<>?";

    let mut rng = rand::rng();
    let mut password = String::with_capacity(20);

    // Ensure at least one character from each set
    password.push(CHARSET_LOWER[rng.random_range(0..CHARSET_LOWER.len())] as char);
    password.push(CHARSET_UPPER[rng.random_range(0..CHARSET_UPPER.len())] as char);
    password.push(CHARSET_NUMBERS[rng.random_range(0..CHARSET_NUMBERS.len())] as char);
    password.push(CHARSET_SPECIAL[rng.random_range(0..CHARSET_SPECIAL.len())] as char);

    // Combine all charsets for remaining characters
    let combined_charset: Vec<u8> = CHARSET_LOWER
        .iter()
        .chain(CHARSET_UPPER)
        .chain(CHARSET_NUMBERS)
        .chain(CHARSET_SPECIAL)
        .copied()
        .collect();

    // Fill the remaining 16 characters
    for _ in 0..16 {
        let idx = rng.random_range(0..combined_charset.len());
        password.push(combined_charset[idx] as char);
    }

    // Shuffle the entire password to avoid predictable character positions
    let mut password_chars: Vec<char> = password.chars().collect();
    password_chars.shuffle(&mut rng);

    password_chars.into_iter().collect()
}
