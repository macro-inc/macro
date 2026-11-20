//! Serves the fake deadsimple.email API for local stacks and previews.
//! No real mail moves; every response says `x-fake-vendor: not-live`.

use clap::Parser;

#[derive(Parser)]
#[command(about = "A fake deadsimple.email API. Not live: no real mail is sent or received.")]
struct Arguments {
    /// Address to listen on.
    #[arg(long, env = "FAKE_VENDOR_LISTEN", default_value = "0.0.0.0:8080")]
    listen: String,
    /// The provisioning key the fake accepts.
    #[arg(long, env = "FAKE_VENDOR_ADMIN_KEY")]
    admin_key: String,
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let arguments = Arguments::parse();
    let listener = tokio::net::TcpListener::bind(&arguments.listen).await?;
    println!(
        "fake vendor, not live: listening on {}",
        listener.local_addr()?
    );
    let router = agent_mailbox_fake_vendor::FakeVendor::new(&arguments.admin_key).router();
    axum::serve(listener, router).await?;
    Ok(())
}
