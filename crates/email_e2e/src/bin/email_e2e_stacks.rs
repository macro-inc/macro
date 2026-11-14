//! Serves email stacks over HTTP for the web app's browser suite: see
//! `email_e2e::serve_stacks`. Prints the address it listens on, then runs
//! until stopped.

use email_e2e::{Report, serve_stacks};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Report> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    println!("http://{}", listener.local_addr()?);
    serve_stacks(listener).await
}
