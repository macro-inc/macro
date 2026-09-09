#![allow(unused)]
#![recursion_limit = "256"]

use macro_env::Environment;

mod config;

const DOPPLER_PROJECT: &str = "agent-egress-service";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    load(Environment::Develop).await?;
    load(Environment::Production).await?;
    Ok(())
}

async fn load(environment: Environment) -> anyhow::Result<()> {
    let doppler = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(environment.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    match doppler.load::<config::Config>().await {
        Ok(_) => Ok(()),
        // The project is created by `infra/stacks/doppler-projects`, which is a
        // human deploy ahead of this service. CI runs this binary as soon as
        // the crate exists, so a missing project is the empty-project
        // chicken-and-egg, not a config-contract failure. Any other error
        // (missing keys once the project exists) still fails the check.
        Err(error) => {
            let error = anyhow::Error::from(error);
            if is_missing_doppler_project(&error) {
                eprintln!(
                    "Doppler project `{DOPPLER_PROJECT}` ({}) does not exist yet; skipping config validation",
                    environment.to_doppler_slug()
                );
                return Ok(());
            }
            Err(error)
        }
    }
}

fn is_missing_doppler_project(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .to_string()
            .contains("Could not find requested project")
    })
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn detects_a_missing_doppler_project() {
        let error = anyhow::anyhow!(
            r#"doppler api returned status 404 Not Found: {{"messages":["Could not find requested project 'agent-egress-service'"],"success":false}}"#
        );
        assert!(is_missing_doppler_project(&error));
    }

    #[test]
    fn other_config_errors_still_fail() {
        let error = anyhow::anyhow!("missing field DATABASE_URL");
        assert!(!is_missing_doppler_project(&error));
    }
}
