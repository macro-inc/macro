//! Generate a local E2E Macro API JWT using the shared Rust token encoder.

use anyhow::{Context, ensure};
use local_e2e_test_support::{
    LocalE2eConfig, LocalE2eSeed, LocalJwtClaims, encode_local_jwt_claims_with,
};

fn read_arg(name: &str) -> Option<String> {
    let prefix = format!("--{name}=");
    let mut args = std::env::args().skip(1).peekable();

    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix(&prefix) {
            return Some(value.to_owned());
        }

        if arg == format!("--{name}") {
            return args.next();
        }
    }

    None
}

fn main() -> anyhow::Result<()> {
    let config = LocalE2eConfig::load()?;
    let seed = LocalE2eSeed::from_config(&config)?;
    let email = read_arg("email").unwrap_or_else(|| seed.manifest.user.email.clone());
    let seed_user = seed.user_by_email(&email);

    let macro_user_id = read_arg("macro-user-id")
        .or_else(|| seed_user.map(|user| user.user_id.clone()))
        .unwrap_or_else(|| format!("macro|{email}"));
    let fusion_user_id = read_arg("fusion-user-id")
        .or_else(|| seed_user.map(|user| user.fusion_user_id.clone()))
        .or_else(|| seed_user.map(|user| user.macro_user_id.clone()))
        .unwrap_or_else(|| "00000000-0000-0000-0003-000000000001".to_owned());

    let expiry_seconds = read_arg("expiry-seconds")
        .or_else(|| {
            config
                .get("MACRO_API_TOKEN_EXPIRY_SECONDS")
                .map(str::to_owned)
        })
        .map(|value| {
            let parsed = value.parse::<usize>().with_context(|| {
                format!("expiry-seconds must be a positive integer, got {value}")
            })?;
            ensure!(parsed > 0, "expiry-seconds must be positive, got {value}");
            Ok(parsed)
        })
        .transpose()?;

    let organization_id = read_arg("organization-id")
        .map(|value| {
            value
                .parse::<i32>()
                .with_context(|| format!("organization-id must be an integer, got {value}"))
        })
        .transpose()?;
    let issuer = read_arg("issuer");

    let token = encode_local_jwt_claims_with(
        &config,
        LocalJwtClaims {
            fusion_user_id: &fusion_user_id,
            macro_user_id: &macro_user_id,
            organization_id,
            issuer: issuer.as_deref(),
            expiry_seconds,
        },
    )?;

    println!("{token}");
    Ok(())
}
