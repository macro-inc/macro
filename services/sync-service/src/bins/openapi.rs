use sync_service::swagger::ApiDoc;
use utoipa::OpenApi;

fn main() -> Result<(), serde_json::Error> {
    println!("{}", ApiDoc::openapi().to_pretty_json()?);
    Ok(())
}
