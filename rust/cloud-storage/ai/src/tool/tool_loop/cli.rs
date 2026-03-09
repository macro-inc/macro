//! CLI interface for the Chat tool loop.
//!
//! This module provides a simple CLI frontend that consumes the existing
//! `Chat` tool loop, allowing developers to test toolsets interactively
//! from the command line.
//!
//! # Example with custom toolset
//!
//! ```rust,ignore
//! use ai::tool::tool_loop::cli::Cli;
//! use ai::tool::{AsyncToolSet, RequestContext};
//! use ai::types::Model;
//! use macro_user_id::user_id::MacroUserIdStr;
//! use std::sync::Arc;
//!
//! #[tokio::main]
//! async fn main() {
//!     let toolset = AsyncToolSet::new()
//!         .add_tool::<MyTool>()
//!         .expect("failed to add tool");
//!
//!     let cli = Cli::new(
//!         toolset,
//!         MyServiceContext::new(),
//!         "You are a helpful assistant.",
//!         Model::Claude35Sonnet,
//!         || RequestContext {
//!             user_id: Arc::new(MacroUserIdStr::try_from_email("user@example.com").unwrap()),
//!             jwt: Arc::new(String::new()),
//!         },
//!     );
//!     cli.run().await;
//! }
//! ```
//!
//! # Example with default (no tools)
//!
//! ```rust,ignore
//! use ai::tool::tool_loop::cli::Cli;
//!
//! #[tokio::main]
//! async fn main() {
//!     Cli::default().run().await;
//! }
//! ```

use crate::prompts::CLI_PROMPT;
use crate::tool::ToolLoop;
use crate::tool::types::{AsyncToolSet, RequestContext, StreamPart, ToolResponse};
use crate::types::{ChatMessage, MessageBuilder, Model, RequestBuilder, Role};
use futures::stream::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use std::io::{self, BufRead, Write};
use std::sync::Arc;

/// CLI interface for the Chat tool loop.
///
/// This struct wraps the tool loop and provides an interactive readline-style
/// interface for multi-turn conversations with tool support.
pub struct Cli<T, F>
where
    T: Clone + Send + Sync + 'static,
    F: Fn() -> RequestContext,
{
    toolset: AsyncToolSet<T>,
    service_context: T,
    system_prompt: String,
    model: Model,
    request_context_fn: F,
}

impl Default for Cli<(), fn() -> RequestContext> {
    fn default() -> Self {
        Self {
            toolset: AsyncToolSet::new(),
            service_context: (),
            system_prompt: CLI_PROMPT.to_string(),
            model: Model::Claude45Opus,
            #[allow(deprecated)]
            request_context_fn: || RequestContext {
                user_id: Arc::new(
                    MacroUserIdStr::try_from_email("cli@localhost").expect("valid email"),
                ),
                jwt: Arc::new(String::new()),
            },
        }
    }
}

impl<T, F> Cli<T, F>
where
    T: Clone + Send + Sync + 'static,
    F: Fn() -> RequestContext,
{
    /// Create a new CLI with the given configuration.
    ///
    /// # Arguments
    ///
    /// * `toolset` - The async toolset to use for tool calls
    /// * `service_context` - The service context passed to tools
    /// * `system_prompt` - The system prompt for the AI
    /// * `model` - The model to use for completions
    /// * `request_context_fn` - A function that creates a request context for each message
    pub fn new(
        toolset: AsyncToolSet<T>,
        service_context: T,
        system_prompt: impl Into<String>,
        model: Model,
        request_context_fn: F,
    ) -> Self {
        Self {
            toolset,
            service_context,
            system_prompt: system_prompt.into(),
            model,
            request_context_fn,
        }
    }

    /// Run the interactive CLI session.
    ///
    /// This provides a readline-style interface that:
    /// - Reads user input from stdin
    /// - Sends messages through the Chat tool loop
    /// - Streams responses to stdout
    /// - Displays tool calls and responses
    /// - Maintains conversation history across turns
    ///
    /// The session ends when the user types "exit" or "quit", or when stdin closes.
    pub async fn run(self) {
        // Print startup info
        println!("Model: {}", self.model);
        let tool_names: Vec<&String> = self.toolset.tools.keys().collect();
        if tool_names.is_empty() {
            println!("Tools: (none)");
        } else {
            println!(
                "Tools: {}",
                tool_names
                    .into_iter()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        println!("---");

        let tool_loop = ToolLoop::new(self.toolset, self.service_context);

        let stdin = io::stdin();
        let mut stdout = io::stdout();
        let mut messages: Vec<ChatMessage> = Vec::new();

        println!("Type 'exit' or 'quit' to end.");
        println!("---");

        loop {
            print!("> ");
            if stdout.flush().is_err() {
                break;
            }

            let input = {
                let handle = stdin.lock();
                match handle.lines().next() {
                    Some(Ok(line)) => line,
                    Some(Err(_)) | None => break,
                }
            };

            let input = input.trim();

            if input.eq_ignore_ascii_case("exit") || input.eq_ignore_ascii_case("quit") {
                println!("Goodbye!");
                break;
            }

            if input.is_empty() {
                continue;
            }

            messages.push(
                MessageBuilder::new()
                    .content(input)
                    .role(Role::User)
                    .build(),
            );

            let request = RequestBuilder::new()
                .system_prompt(&self.system_prompt)
                .messages(messages.clone())
                .model(self.model)
                .build();

            let mut chat = tool_loop.chat();
            let request_context = (self.request_context_fn)();

            // Process stream in a scope so it's dropped before accessing chat
            let stream_error = {
                let stream_result = chat
                    .send_message(request, request_context, "cli-user".to_string())
                    .await;

                let mut stream = match stream_result {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("\nError: {}", e);
                        messages.pop();
                        continue;
                    }
                };

                let mut has_content = false;
                let mut error_occurred = false;

                while let Some(result) = stream.next().await {
                    match result {
                        Ok(part) => match part {
                            StreamPart::Content(content) => {
                                print!("{}", content);
                                let _ = stdout.flush();
                                has_content = true;
                            }
                            StreamPart::ToolCall(call) => {
                                if has_content {
                                    println!();
                                }
                                println!("\n[Tool Call: {}]", call.name);
                                if let Ok(pretty) = serde_json::to_string_pretty(&call.json) {
                                    println!("{}", pretty);
                                }
                                has_content = false;
                            }
                            StreamPart::ToolResponse(response) => {
                                match &response {
                                    ToolResponse::Json { name, json, .. } => {
                                        println!("\n[Tool Response: {}]", name);
                                        if let Ok(pretty) = serde_json::to_string_pretty(json) {
                                            let display = if pretty.len() > 500 {
                                                format!("{}...(truncated)", &pretty[..500])
                                            } else {
                                                pretty
                                            };
                                            println!("{}", display);
                                        }
                                    }
                                    ToolResponse::Err {
                                        name, description, ..
                                    } => {
                                        println!("\n[Tool Error: {}]", name);
                                        println!("{}", description);
                                    }
                                }
                                println!();
                            }
                            StreamPart::Usage(usage) => {
                                tracing::debug!(usage=?usage, "token usage");
                            }
                        },
                        Err(e) => {
                            eprintln!("\nStream error: {}", e);
                            error_occurred = true;
                            break;
                        }
                    }
                }

                if has_content {
                    println!();
                }
                println!("---");

                error_occurred
            };

            if stream_error {
                messages.pop();
                continue;
            }

            let new_messages = chat.get_new_conversation_messages();
            messages.extend(new_messages);
        }
    }
}
