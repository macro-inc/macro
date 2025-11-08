use ai::simple_completion::simple_completion;
use ai::types::Model;
use anyhow::Error;
use model::document::DocumentBasic;

pub async fn summarize_document(text: String, _: DocumentBasic) -> Result<String, Error> {
    const SUMMARIZER_MODEL: Model = Model::OpenAiGpt41;
    const SYSTEM_PROMPT: &str = "You are a summarizer tool. Your job is to summarize the document context you are given. You
    summaries should be no longer than 5 sentences. The request section will contain the document you are to summarize";

    simple_completion(SYSTEM_PROMPT, text.as_str(), SUMMARIZER_MODEL).await
}
