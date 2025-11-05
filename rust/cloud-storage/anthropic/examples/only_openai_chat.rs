// copied from https://github.com/64bit/async-openai/blob/main/examples/chat-stream/src/main.rs
use std::error::Error;
use std::io::{Write, stdout};

use async_openai::types::ChatCompletionRequestUserMessageArgs;
use async_openai::types::CreateChatCompletionRequestArgs;
use futures::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let request = CreateChatCompletionRequestArgs::default()
        .model("claude-haiku-4-5")
        .max_tokens(512u32)
        .messages([ChatCompletionRequestUserMessageArgs::default()
            .content("Write a marketing blog praising and introducing Rust library async-openai")
            .build()?
            .into()])
        .build()?;
    println!("{:#?}", request);

    let client = anthropic::client::Client::dangerously_try_from_env();
    let mut stream = client.chat().create_stream_openai(request).await;

    let mut lock = stdout().lock();
    while let Some(result) = stream.next().await {
        match result {
            Ok(response) => {
                response.choices.iter().for_each(|chat_choice| {
                    if let Some(ref content) = chat_choice.delta.content {
                        write!(lock, "{}", content).unwrap();
                    }
                });
            }
            Err(err) => {
                writeln!(lock, "error: {err:?}").unwrap();
            }
        }
        stdout().flush()?;
    }

    Ok(())
}
