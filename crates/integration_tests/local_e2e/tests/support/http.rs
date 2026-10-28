const LOCAL_CA: &[u8] = include_bytes!("../../../../../infra/local/certs/ca.pem");

pub fn http_client() -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .add_root_certificate(reqwest::Certificate::from_pem(LOCAL_CA)?)
        .build()?)
}
