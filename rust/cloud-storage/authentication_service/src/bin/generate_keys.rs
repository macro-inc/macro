use anyhow::Context;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use openssl::{pkey::PKey, rsa::Rsa};
use rsa::{RsaPrivateKey, pkcs1::DecodeRsaPrivateKey, traits::PublicKeyParts};
use serde_json::json;
use std::fs;

fn main() -> anyhow::Result<()> {
    let env = std::env::args().nth(1).unwrap_or("dev".to_string());
    println!("Generating keys for environment {env}");

    // Generate 2048-bit RSA private key
    let rsa = Rsa::generate(2048).context("unable to generate rsa key")?;
    let private_key = PKey::from_rsa(rsa).context("unable to convert rsa key to pkey")?;

    // Convert private key to PEM format (PKCS#1 format to match openssl genrsa)
    let private_pem = private_key
        .rsa()?
        .private_key_to_pem()
        .context("unable to convert pkey to pem")?;

    // Write private key to file
    fs::write("./output/private.pem", &private_pem)
        .context("unable to write private key to file")?;

    // Extract public key from private key
    let public_key = private_key
        .public_key_to_pem()
        .context("unable to convert pkey to pem")?;

    // Write public key to file
    fs::write("./output/public.pem", &public_key).context("unable to write public key to file")?;

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
