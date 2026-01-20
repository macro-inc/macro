use ai::tool::Cli;

#[tokio::main]
async fn main() {
    Cli::default().run().await;
}
