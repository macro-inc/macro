use serde::Deserialize;

/// Deserializes a list of semicolon separated items into a vec of strings
pub fn deserialize_semicolon_list<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    if s.is_empty() {
        return Ok(Vec::new());
    }
    Ok(s.split(';').map(|s| s.trim().to_string()).collect())
}
