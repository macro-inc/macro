use properties_service::api::swagger::ApiDoc;
use utoipa::OpenApi;

fn main() {
    let doc = ApiDoc::openapi();
    println!("{}", serde_json::to_string_pretty(&doc).unwrap());
}
