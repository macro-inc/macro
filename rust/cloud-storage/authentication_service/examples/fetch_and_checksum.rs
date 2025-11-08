use authentication_service::fetch_and_checksum::fetch_and_checksum;
use std::env;
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        println!("Supply a URL");
        return Ok(());
    }

    let url: &str = &args[1];

    dbg!(url);

    let checksum = fetch_and_checksum(url).await?;

    println!("{}", checksum);

    Ok(())
}
