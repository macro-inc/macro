// copied from https://github.com/64bit/async-openai/blob/main/examples/tool-call-stream/src/main.rs
use std::collections::HashMap;
use std::error::Error;
use std::io::{Write, stdout};
use std::sync::Arc;

use async_openai::types::CreateChatCompletionRequestArgs;
use async_openai::types::{
    ChatCompletionMessageToolCall, ChatCompletionRequestAssistantMessageArgs,
    ChatCompletionRequestMessage, ChatCompletionRequestToolMessageArgs,
    ChatCompletionRequestUserMessageArgs, ChatCompletionToolArgs, ChatCompletionToolType,
    FinishReason, FunctionCall, FunctionObjectArgs,
};
use futures::StreamExt;
use rand::prelude::*;
use serde_json::{Value, json};
use tokio::sync::Mutex;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let user_prompt = "What's the weather like in Boston and Atlanta?";
    let tools = vec![
        ChatCompletionToolArgs::default()
            .r#type(ChatCompletionToolType::Function)
            .function(
                FunctionObjectArgs::default()
                    .name("get_current_weather")
                    .description("Get the current weather in a given location")
                    .parameters(json!({
                        "type": "object",
                        "properties": {
                            "location": {
                                "type": "string",
                                "description": "The city and state, e.g. San Francisco, CA",
                            },
                            "unit": { "type": "string", "enum": ["celsius", "fahrenheit"] },
                        },
                        "required": ["location"],
                    }))
                    .build()?,
            )
            .build()?,
    ];
    let request = CreateChatCompletionRequestArgs::default()
        .max_tokens(6000_u32)
        .model("claude-haiku-4-5")
        .messages([ChatCompletionRequestUserMessageArgs::default()
            .content(user_prompt)
            .build()?
            .into()])
        .tools(tools.clone())
        .build()?;

    let client = anthropic::client::Client::dangerously_try_from_env();
    let mut stream = client.chat().create_stream_openai(request).await;

    let tool_call_states: Arc<Mutex<HashMap<(u32, u32), ChatCompletionMessageToolCall>>> =
        Arc::new(Mutex::new(HashMap::new()));

    while let Some(result) = stream.next().await {
        match result {
            Ok(response) => {
                for chat_choice in response.choices {
                    let function_responses: Arc<
                        Mutex<Vec<(ChatCompletionMessageToolCall, Value)>>,
                    > = Arc::new(Mutex::new(Vec::new()));
                    if let Some(tool_calls) = chat_choice.delta.tool_calls {
                        for tool_call_chunk in tool_calls.into_iter() {
                            let key = (chat_choice.index, tool_call_chunk.index);
                            let states = tool_call_states.clone();
                            let tool_call_data = tool_call_chunk.clone();

                            let mut states_lock = states.lock().await;
                            let state = states_lock.entry(key).or_insert_with(|| {
                                ChatCompletionMessageToolCall {
                                    id: tool_call_data.id.clone().unwrap_or_default(),
                                    r#type: ChatCompletionToolType::Function,
                                    function: FunctionCall {
                                        name: tool_call_data
                                            .function
                                            .as_ref()
                                            .and_then(|f| f.name.clone())
                                            .unwrap_or_default(),
                                        arguments: tool_call_data
                                            .function
                                            .as_ref()
                                            .and_then(|f| f.arguments.clone())
                                            .unwrap_or_default(),
                                    },
                                }
                            });
                            if let Some(arguments) = tool_call_chunk
                                .function
                                .as_ref()
                                .and_then(|f| f.arguments.as_ref())
                            {
                                state.function.arguments.push_str(arguments);
                            }
                        }
                    }
                    if let Some(finish_reason) = &chat_choice.finish_reason {
                        if matches!(finish_reason, FinishReason::ToolCalls) {
                            let tool_call_states_clone = tool_call_states.clone();

                            let tool_calls_to_process = {
                                let states_lock = tool_call_states_clone.lock().await;
                                states_lock
                                    .iter()
                                    .map(|(_key, tool_call)| {
                                        let name = tool_call.function.name.clone();
                                        let args = tool_call.function.arguments.clone();
                                        let tool_call_clone = tool_call.clone();
                                        (name, args, tool_call_clone)
                                    })
                                    .collect::<Vec<_>>()
                            };

                            let mut handles = Vec::new();
                            for (name, args, tool_call_clone) in tool_calls_to_process {
                                let response_content_clone = function_responses.clone();
                                let handle = tokio::spawn(async move {
                                    let response_content = call_fn(&name, &args).await.unwrap();

                                    let mut function_responses_lock =
                                        response_content_clone.lock().await;
                                    function_responses_lock
                                        .push((tool_call_clone, response_content));
                                });
                                handles.push(handle);
                            }

                            for handle in handles {
                                handle.await.unwrap();
                            }

                            let function_responses_clone = function_responses.clone();
                            let function_responses_lock = function_responses_clone.lock().await;
                            let mut messages: Vec<ChatCompletionRequestMessage> = vec![
                                ChatCompletionRequestUserMessageArgs::default()
                                    .content(user_prompt)
                                    .build()?
                                    .into(),
                            ];

                            let tool_calls: Vec<ChatCompletionMessageToolCall> =
                                function_responses_lock
                                    .iter()
                                    .map(|tc| tc.0.clone())
                                    .collect();

                            let assistant_messages: ChatCompletionRequestMessage =
                                ChatCompletionRequestAssistantMessageArgs::default()
                                    .tool_calls(tool_calls)
                                    .build()
                                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
                                    .unwrap()
                                    .into();

                            let tool_messages: Vec<ChatCompletionRequestMessage> =
                                function_responses_lock
                                    .iter()
                                    .map(|tc| {
                                        ChatCompletionRequestToolMessageArgs::default()
                                            .content(tc.1.to_string())
                                            .tool_call_id(tc.0.id.clone())
                                            .build()
                                            .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
                                            .unwrap()
                                            .into()
                                    })
                                    .collect();

                            messages.push(assistant_messages);
                            messages.extend(tool_messages);

                            let request = CreateChatCompletionRequestArgs::default()
                                .max_tokens(6000_u32)
                                .model("claude-haiku-4-5")
                                .messages(messages)
                                .tools(tools.clone())
                                .build()
                                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

                            let mut stream = client.chat().create_stream_openai(request).await;

                            let mut response_content = String::new();
                            let mut lock = stdout().lock();
                            while let Some(result) = stream.next().await {
                                match result {
                                    Ok(response) => {
                                        for chat_choice in response.choices.iter() {
                                            if let Some(ref content) = chat_choice.delta.content {
                                                write!(lock, "{}", content).unwrap();
                                                response_content.push_str(content);
                                            }
                                        }
                                    }
                                    Err(err) => {
                                        return Err(Box::new(err) as Box<dyn std::error::Error>);
                                    }
                                }
                            }
                        }
                    }

                    if let Some(content) = &chat_choice.delta.content {
                        let mut lock = stdout().lock();
                        write!(lock, "{}", content).unwrap();
                    }
                }
            }
            Err(err) => {
                let mut lock = stdout().lock();
                writeln!(lock, "error: {err:?}").unwrap();
            }
        }
        stdout()
            .flush()
            .map_err(|e| Box::new(e) as Box<dyn Error>)?;
    }

    Ok(())
}

async fn call_fn(name: &str, args: &str) -> Result<Value, Box<dyn std::error::Error>> {
    println!("call function! {}({})", name, args);
    let mut available_functions: HashMap<&str, fn(&str, &str) -> serde_json::Value> =
        HashMap::new();
    available_functions.insert("get_current_weather", get_current_weather);

    let function_args: serde_json::Value = args.parse().unwrap();

    let location = function_args["location"].as_str().unwrap();
    let unit = function_args["unit"].as_str().unwrap_or("fahrenheit");
    let function = available_functions.get(name).unwrap();
    let function_response = function(location, unit);
    Ok(function_response)
}

fn get_current_weather(location: &str, unit: &str) -> serde_json::Value {
    let mut rng = rand::thread_rng();

    let temperature: i32 = rng.gen_range(20..=55);

    let forecasts = [
        "sunny", "cloudy", "overcast", "rainy", "windy", "foggy", "snowy",
    ];

    let forecast = forecasts.choose(&mut rng).unwrap_or(&"sunny");

    let weather_info = json!({
        "location": location,
        "temperature": temperature.to_string(),
        "unit": unit,
        "forecast": forecast
    });

    weather_info
}
