use crate::types::ToolObject;
use async_openai::types::{ChatCompletionTool, ChatCompletionToolType, FunctionObject};

impl<T> From<&ToolObject<T>> for ChatCompletionTool {
    fn from(value: &ToolObject<T>) -> Self {
        Self {
            r#type: ChatCompletionToolType::Function,
            function: FunctionObject {
                name: value.name.clone(),
                description: Some(value.description.clone()),
                parameters: Some(value.input_schema.clone()),
                strict: Some(true),
            },
        }
    }
}

impl<T> ToolSet<T>
where
    ChatCompletionTool: for<'a> From<&'a T>,
{
    pub fn openai_chatcompletion_toolset(&self) -> Vec<ChatCompletionTool> {
        self.tools.values().map(ChatCompletionTool::from).collect()
    }
}
