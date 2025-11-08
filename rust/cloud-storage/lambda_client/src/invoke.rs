use anyhow::Context;
use aws_smithy_types::Blob;

/// Invokes the lambda as an event.
/// It does not wait for the response.
#[tracing::instrument(skip(client))]
pub(crate) async fn invoke_event<T>(
    client: &aws_sdk_lambda::Client,
    function_name: &str,
    invoke_args: &T,
) -> anyhow::Result<()>
where
    T: serde::Serialize + std::fmt::Debug,
{
    let payload = serde_json::to_string(invoke_args).context("unable to serialize invoke args")?;

    let response = client
        .invoke()
        .function_name(function_name)
        .invocation_type(aws_sdk_lambda::types::InvocationType::Event)
        .payload(Blob::new(payload))
        .send()
        .await
        .context("unable to invoke lambda")?;

    // 202 is the expected status code for Event invocations
    if response.status_code() != 202 {
        tracing::error!(
            "lambda invocation failed with status code {}",
            response.status_code()
        );
        return Err(anyhow::anyhow!(
            "lambda invocation failed with status code {}",
            response.status_code()
        ));
    }

    Ok(())
}
