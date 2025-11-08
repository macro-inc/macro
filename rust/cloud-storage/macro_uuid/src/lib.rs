use anyhow::{Result, anyhow};
use uuid::{NoContext, Timestamp, Uuid};

pub fn generate_uuid_v7() -> Uuid {
    Uuid::new_v7(Timestamp::now(NoContext))
}

pub fn string_to_uuid(s: &str) -> Result<Uuid> {
    Uuid::parse_str(s).map_err(|e| anyhow!(e))
}

// Flickr's base58 alphabet as used in short-uuid
const FLICKR_BASE58: &str = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

pub struct ShortUuidConverter {
    alphabet: String,
    base: u128,
    char_map: std::collections::HashMap<char, u128>,
}

impl Default for ShortUuidConverter {
    fn default() -> Self {
        let alphabet = FLICKR_BASE58.to_string();
        let base = alphabet.chars().count() as u128;
        let char_map = alphabet
            .chars()
            .enumerate()
            .map(|(i, c)| (c, i as u128))
            .collect();

        Self {
            alphabet,
            base,
            char_map,
        }
    }
}

impl ShortUuidConverter {
    /// checks if a string is a valid short UUID
    pub fn is_short_uuid(&self, s: &str) -> bool {
        // Short UUIDs using Flickr's base58:
        // 1. Must not be empty
        // 2. Must only contain characters from the Flickr base58 alphabet
        // 3. Typically shorter than standard UUID (which is 36 chars)
        // 4. Must not be longer than maximum possible length for a UUID in base58

        if s.is_empty() || s.len() >= 25 {
            // 25 is a safe upper bound for base58 UUID
            return false;
        }

        s.chars().all(|c| self.char_map.contains_key(&c))
    }

    /// checks if a string is a standard UUID
    pub fn is_standard_uuid(s: &str) -> bool {
        Uuid::parse_str(s).is_ok()
    }

    /// converts short uuid to uuid
    pub fn to_uuid(&self, short_uuid: &str) -> Result<Uuid> {
        if !self.is_short_uuid(short_uuid) {
            return Err(anyhow!("Invalid short UUID format"));
        }

        // Convert from base58 to number
        let mut num: u128 = 0;
        for c in short_uuid.chars() {
            let digit = self
                .char_map
                .get(&c)
                .ok_or_else(|| anyhow!("Invalid character in short UUID: {}", c))?;
            num = num * self.base + digit;
        }

        // Convert number to bytes (16 bytes for UUID)
        let bytes: [u8; 16] = num.to_be_bytes();
        Ok(Uuid::from_bytes(bytes))
    }

    /// converts uuid to short form
    pub fn from_uuid(&self, uuid: &Uuid) -> String {
        let mut num = u128::from_be_bytes(*uuid.as_bytes());
        let mut short = String::new();

        // Convert to base58
        while num > 0 {
            let rem = (num % self.base) as usize;
            short.push(self.alphabet.chars().nth(rem).unwrap());
            num /= self.base;
        }

        // Reverse the string
        short.chars().rev().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bidirectional_conversion() {
        let converter = ShortUuidConverter::default();

        // Start with a known UUID
        let original_uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();

        // Convert to short UUID
        let short = converter.from_uuid(&original_uuid);

        // Convert back to UUID
        let recovered_uuid = converter.to_uuid(&short).unwrap();

        // They should match
        assert_eq!(original_uuid, recovered_uuid);
    }
    #[test]
    fn test_specific_conversion() {
        let converter = ShortUuidConverter::default();
        // TODO: add more tests
        let uuids = vec![(
            "0d0dc589-f301-43f1-8b11-4ab448ca4bb4",
            "2BuyvtY3aeEvHx4uG8iD51",
        )];

        for (uuid, short) in uuids {
            let converted_uuid = Uuid::parse_str(uuid).unwrap();
            let converted_short = converter.from_uuid(&converted_uuid);
            assert_eq!((uuid, converted_short.as_str()), (uuid, short));
        }
    }
}
