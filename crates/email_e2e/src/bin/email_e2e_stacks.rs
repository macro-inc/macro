//! Serves email stacks over HTTP for the web app's browser suite: see
//! `email_e2e::serve_stacks`. Prints the address it listens on, then runs
//! until stopped.

use email_e2e::{Report, raise_open_file_limit, serve_stacks};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Report> {
    // A dozen stacks at once hold more files than a default limit allows. The
    // address is the first line of stdout, so this goes to stderr.
    if let Some(previous) = raise_open_file_limit()? {
        eprintln!("email_e2e: raised the open-file limit from {previous}");
    }

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    println!("http://{}", listener.local_addr()?);
    serve_stacks(listener).await
}
