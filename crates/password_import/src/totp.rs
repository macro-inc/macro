//! One-time-password secrets: `otpauth://totp/...` URIs or bare base32.
use zeroize::Zeroizing;

use crate::model::{Secret, TotpSeed};

/// The vault's TOTP key limit.
const MAX_SEED_BYTES: usize = 1024;

/// The seed when `raw` is a valid secret with default parameters (SHA1, 6
/// digits, 30 s); `None` means the caller keeps `raw` as a concealed field.
pub(crate) fn default_seed(raw: &str) -> Option<TotpSeed> {
    let raw = raw.trim();
    let is_uri = raw
        .get(..OTPAUTH_SCHEME.len())
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case(OTPAUTH_SCHEME));

    if is_uri {
        seed_from_uri(raw)
    } else {
        normalize_base32(raw)
    }
}

const OTPAUTH_SCHEME: &str = "otpauth://";

fn seed_from_uri(raw: &str) -> Option<TotpSeed> {
    let uri = url::Url::parse(raw).ok()?;
    if !uri.host_str()?.eq_ignore_ascii_case("totp") {
        return None;
    }

    let mut secret = None;
    for (key, value) in uri.query_pairs() {
        let is_default = match key.to_ascii_lowercase().as_str() {
            "secret" => {
                // A repeated secret is ambiguous.
                if secret.is_some() {
                    return None;
                }
                secret = Some(Zeroizing::new(value.into_owned()));
                true
            }
            "algorithm" => value.eq_ignore_ascii_case("SHA1"),
            "digits" => value == "6",
            "period" => value == "30",
            _ => true,
        };

        if !is_default {
            return None;
        }
    }

    normalize_base32(&secret?)
}

/// Uppercase base32 without whitespace or `=` padding.
fn normalize_base32(raw: &str) -> Option<TotpSeed> {
    let mut seed = Zeroizing::new(String::with_capacity(raw.len()));
    for character in raw.chars().filter(|character| !character.is_whitespace()) {
        seed.push(character.to_ascii_uppercase());
    }

    let unpadded_len = seed.trim_end_matches('=').len();
    seed.truncate(unpadded_len);

    let valid = !seed.is_empty()
        && seed.len() <= MAX_SEED_BYTES
        && seed.bytes().all(|byte| matches!(byte, b'A'..=b'Z' | b'2'..=b'7'));

    valid.then(|| TotpSeed(Secret::new(std::mem::take(&mut *seed))))
}

#[cfg(test)]
mod test;
