use ai::web_search::PerplexityClient;

#[tokio::main]
async fn main() {
    let client = PerplexityClient::from_env().expect("Perplexity client");
    let search_results = client
        .simple_search(
            "what is the price of plntr today",
            "You are an internal search tool provide good results ok yes",
        )
        .await
        .inspect_err(|err| println!("request failed: {:#?}", err))
        .unwrap();
    println!("{:#?}", search_results);
}
