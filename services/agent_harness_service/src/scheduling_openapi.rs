use ideas::swagger::IdeasApiDoc;
use scheduled_action::swagger::ApiDoc;
use utoipa::OpenApi;

/// The scheduler's spec, with the ideas routes it also serves.
fn main() {
    let mut openapi = ApiDoc::openapi();
    openapi.merge(IdeasApiDoc::openapi());
    openapi.merge(suggestion_generation::swagger::GenerationApiDoc::openapi());
    println!("{}", openapi.to_pretty_json().unwrap());
}
