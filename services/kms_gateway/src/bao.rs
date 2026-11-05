//! OpenBao's transit engine.

use reqwest::StatusCode;
use rootcause::{Report, bail};
use serde_json::{Value, json};

#[derive(Clone)]
pub struct Transit {
    client: reqwest::Client,
    addr: String,
    token: String,
}

/// Why a decrypt returned nothing.
pub enum DecryptError {
    /// The ciphertext is not valid for this key and context.
    Rejected,
    Failed(Report),
}

impl Transit {
    pub fn new(addr: String, token: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            addr,
            token,
        }
    }

    async fn post(&self, path: &str, body: &Value) -> Result<reqwest::Response, Report> {
        Ok(self
            .client
            .post(format!("{}/v1/transit/{path}", self.addr))
            .header("X-Vault-Token", &self.token)
            .json(body)
            .send()
            .await?)
    }

    /// Encrypts base64 `plaintext` under `key`, creating the key if it is new.
    pub async fn encrypt(
        &self,
        key: &str,
        plaintext: &str,
        associated_data: &str,
    ) -> Result<String, Report> {
        let response = self
            .post(
                &format!("encrypt/{key}"),
                &json!({ "plaintext": plaintext, "associated_data": associated_data }),
            )
            .await?;
        let status = response.status();
        if !status.is_success() {
            bail!("transit encrypt returned {status}");
        }
        let body: Value = response.json().await?;
        match body["data"]["ciphertext"].as_str() {
            Some(ciphertext) => Ok(ciphertext.to_owned()),
            None => bail!("transit encrypt returned no ciphertext"),
        }
    }

    /// Decrypts to base64 plaintext.
    pub async fn decrypt(
        &self,
        key: &str,
        ciphertext: &str,
        associated_data: &str,
    ) -> Result<String, DecryptError> {
        let response = self
            .post(
                &format!("decrypt/{key}"),
                &json!({ "ciphertext": ciphertext, "associated_data": associated_data }),
            )
            .await
            .map_err(DecryptError::Failed)?;
        match response.status() {
            StatusCode::BAD_REQUEST => return Err(DecryptError::Rejected),
            status if !status.is_success() => {
                return Err(DecryptError::Failed(rootcause::report!(
                    "transit decrypt returned {status}"
                )));
            }
            _ => {}
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| DecryptError::Failed(error.into()))?;
        body["data"]["plaintext"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| {
                DecryptError::Failed(rootcause::report!("transit decrypt returned no plaintext"))
            })
    }
}
