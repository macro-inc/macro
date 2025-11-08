use static_file_service_client::StaticFileServiceClient;
use std::env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        println!("Supply a file ID");
        return Ok(());
    }

    let file_id: &str = &args[1];
    dbg!(file_id);

    let internal_auth_key =
        env::var("INTERNAL_API_SECRET_KEY").expect("INTERNAL_API_SECRET_KEY must be set");
    let url = env::var("STATIC_FILE_SERVICE_URL").expect("STATIC_FILE_SERVICE_URL must be set");
    let client = StaticFileServiceClient::new(internal_auth_key, url);
    client.delete_file(file_id).await?;
    Ok(())
}
