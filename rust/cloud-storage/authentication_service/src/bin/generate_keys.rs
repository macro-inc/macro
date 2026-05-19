use anyhow::Context;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rsa::{
    RsaPrivateKey,
    pkcs1::{DecodeRsaPrivateKey, EncodeRsaPrivateKey, LineEnding as Pkcs1LineEnding},
    pkcs8::{EncodePublicKey, LineEnding as Pkcs8LineEnding},
    rand_core::OsRng,
    traits::PublicKeyParts,
};
use serde_json::json;
use std::fs;

fn main() -> anyhow::Result<()> {
    let env = std::env::args().nth(1).unwrap_or("dev".to_string());
    println!("Generating keys for environment {env}");

    // Generate 2048-bit RSA private key
    let mut rng = OsRng;
    let private_key = RsaPrivateKey::new(&mut rng, 2048).context("unable to generate rsa key")?;

    // Convert private key to PEM format
    let private_pem = private_key
        .to_pkcs1_pem(Pkcs1LineEnding::LF)
        .context("unable to convert private key to pem")?;

    // Write private key to file
    fs::write("./output/private.pem", private_pem.as_bytes())
        .context("unable to write private key to file")?;

    // Extract public key from private key
    let public_key = private_key
        .to_public_key()
        .to_public_key_pem(Pkcs8LineEnding::LF)
        .context("unable to convert public key to pem")?;

    // Write public key to file
    fs::write("./output/public.pem", public_key.as_bytes())
        .context("unable to write public key to file")?;

    // Read the private key PEM file
    let private_key_pem =
        fs::read_to_string("./output/private.pem").context("unable to read private key")?;

    // Parse the private key
    let private_key =
        RsaPrivateKey::from_pkcs1_pem(&private_key_pem).context("unable to parse private key")?;

    // Extract the public key components
    let public_key = private_key.to_public_key();
    let n = public_key.n();
    let e = public_key.e();

    // Convert to base64url encoding (without padding)
    let n_bytes = n.to_bytes_be();
    let e_bytes = e.to_bytes_be();
    let n_b64 = URL_SAFE_NO_PAD.encode(&n_bytes);
    let e_b64 = URL_SAFE_NO_PAD.encode(&e_bytes);

    // Create the public JWK
    let public_jwk = json!({
        "kty": "RSA",
        "use": "sig",
        "kid": format!("macro_access_token_{env}"),
        "n": n_b64,
        "e": e_b64,
        "alg": "RS256"
    });

    // Create the JWKS
    let jwks = json!({
        "keys": [public_jwk]
    });

    // Write to file
    fs::write(
        "./output/jwks.json",
        serde_json::to_string_pretty(&jwks).context("unable to write jwks")?,
    )?;

    println!("JWKS file created successfully!");
    Ok(())
}
