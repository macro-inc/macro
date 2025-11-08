use anyhow::Result;
use tiktoken_rs::o200k_base;

/// Counts the number of tokens in a string
pub fn count_tokens(text: &str) -> Result<i64> {
    let encoding = o200k_base()?;
    let tokens = encoding.encode_with_special_tokens(text);
    Ok(tokens.len() as i64)
}

pub trait TokenCount {
    fn token_count(&self) -> Result<i64>;
}
