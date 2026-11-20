//! Serves the brain CAPTCHA and Fireworks routes over a solver-run database; see
//! [`agent_harness_service::brain_bench`].

use macro_entrypoint::MacroEntrypoint;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = agent_harness_service::brain_bench::run().await;
    entrypoint.shutdown();
    result
}
