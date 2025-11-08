use crate::types::Model;
use crate::types::OpenRouterClient;
use anyhow::Result;
use async_openai::types::{CreateCompletionRequestArgs, Prompt};

pub async fn simple_completion(prompt: &str, request: &str, model: Model) -> Result<String> {
    let client = OpenRouterClient::new();
    let prompt = format!(
        "___SYSTEM PROMPT___\n{}\n___END SYSTEM PROMPT___\n___BEGIN REQUEST___\n{}",
        prompt, request
    );
    let request = CreateCompletionRequestArgs::default()
        .model(model.to_string())
        .prompt(Prompt::String(prompt))
        .stream(false)
        .build()?;

    let response = client.completions().create(request).await?;

    for choice in response.choices {
        if !choice.text.is_empty() {
            return Ok(choice.text);
        }
    }
    Err(anyhow::anyhow!("completion returned empty response"))
}
