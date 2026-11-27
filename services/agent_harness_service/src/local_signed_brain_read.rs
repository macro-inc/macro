#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    agent_harness_service::run_local_signed_brain_read().await
}
