use scheduled_action::swagger::ApiDoc;
use suggestions::swagger::SuggestionsApiDoc;
use utoipa::OpenApi;

/// The scheduler's spec, with the suggestions routes it also serves.
fn main() {
    let mut openapi = ApiDoc::openapi();
    openapi.merge(SuggestionsApiDoc::openapi());
    println!("{}", openapi.to_pretty_json().unwrap());
}
