use static_file_service_client::StaticFileServiceClient;
use std::env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let internal_auth_key =
        env::var("INTERNAL_API_SECRET_KEY").expect("INTERNAL_API_SECRET_KEY must be set");
    let url = env::var("STATIC_FILE_SERVICE_URL").expect("STATIC_FILE_SERVICE_URL must be set");
    let client = StaticFileServiceClient::new(internal_auth_key, url);
    let res = client
        .put_file("http://localhost:8081/some_file.jpg")
        .await?;
    dbg!(&res);
    Ok(())
}
