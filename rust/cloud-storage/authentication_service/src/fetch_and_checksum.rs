use sha1::{Digest, Sha1};

pub async fn fetch_and_checksum(url: &str) -> Result<String, anyhow::Error> {
    let client = reqwest::Client::new();
    let response = client.get(url).send().await?;
    let bytes = response.bytes().await?;

    let mut hasher = Sha1::new();
    hasher.update(&bytes);
    let hash = format!("{:x}", hasher.finalize());

    Ok(hash)
}
