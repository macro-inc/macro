use crate::constants::header_names::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY;
use serde_json::json;
use tracing::{debug, error};
use worker::{Fetch, Method, Request, RequestInit};

pub async fn update(document_id: &str, env: &worker::Env) -> worker::Result<()> {
    let internal_auth_key = env
        .secret("SPS_API_SECRET_KEY")
        .inspect_err(|e| error!(error=%e, "Could not find API SPS key binding"))?
        .to_string();
    let url = env
        .var("SPS_URL")
        .inspect_err(|e| error!(error=%e, "Could not find SPS URL binding"))?
        .to_string();

    let url = format!("{url}/internal/extract_sync");
    let json_body = json!({
        "documents": [{
            "document_id": document_id,
            "file_type": "md",
        }]
    });

    let mut request = Request::new_with_init(
        &url,
        RequestInit::new()
            .with_method(Method::Post)
            .with_body(Some(json_body.to_string().into())),
    )?;

    let headers = request.headers_mut()?;
    headers.set("Content-Type", "application/json")?;
    headers.set(MACRO_INTERNAL_AUTH_KEY_HEADER_KEY, &internal_auth_key)?;

    let mut response = Fetch::Request(request).send().await?;
    if response.status_code() != 200 {
        error!("non-200 response from sps");
        match response.text().await {
            Ok(body) => error!("non-200 response body:\n{body}"),
            Err(e) => error!("couldn't read non-200 response body to string. Error: {e:?}"),
        }
    }
    debug!("finished sending search index update");
    Ok(())
}
