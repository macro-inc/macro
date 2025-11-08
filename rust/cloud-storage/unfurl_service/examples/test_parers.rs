use unfurl_service::url_parsers::{
    parse_custom_title, parse_figma_title, parse_linear_title, parse_notion_title,
};

fn main() {
    println!("Testing Custom URL Parsers\n");

    // Test Notion URLs
    println!("=== Notion URLs ===");
    let notion_urls = [
        "https://www.notion.so/macrocom/Enterprise-Product-Bottlenecks-5acb869109a747c1a1a92bbf1891ff2d",
        "https://www.notion.so/Macro-Work-Thoughts-e52b32630b2e45fab665b3e5c566cf3b",
        "https://www.notion.so/craft-ventures/Craft-Ventures-Operating-Playbooks-9db7bdccfc0f47be96076c122513691c",
        "https://www.notion.so", // Should return "Notion" as fallback
    ];

    for url in &notion_urls {
        match parse_notion_title(url) {
            Some(title) => println!("✅ {} -> {}", url, title),
            None => match parse_custom_title(url) {
                Some(title) => println!("✅ {} -> {} (fallback)", url, title),
                None => println!("❌ {} -> Failed to parse", url),
            },
        }
    }

    // Test Figma URLs
    println!("\n=== Figma URLs ===");
    let figma_urls = [
        "https://www.figma.com/design/Kf1Vep5riU3re2GO4E0q6b/Peter-Copy-of-Paper-Crowns?node-id=0-1&p=f&t=Z2dZh8AyxauKitCl-0",
        "https://www.figma.com/design/VWgAP7zMauuWKkeS3CmWk3/AI-side-panel?node-id=0-1&p=f&t=SqdP6D2w2rZ5iSjV-0",
        "https://www.figma.com", // Should return "Figma" as fallback
    ];

    for url in &figma_urls {
        match parse_figma_title(url) {
            Some(title) => println!("✅ {} -> {}", url, title),
            None => match parse_custom_title(url) {
                Some(title) => println!("✅ {} -> {} (fallback)", url, title),
                None => println!("❌ {} -> Failed to parse", url),
            },
        }
    }

    // Test Linear URLs
    println!("\n=== Linear URLs ===");
    let linear_urls = [
        "https://linear.app/macro-eng/issue/M-3586/ability-to-archive-emails",
        "https://linear.app/macro-eng/issue/M-3421/add-macro-permissions-to-jwt-token",
        "https://linear.app", // Should return "Linear" as fallback
    ];

    for url in &linear_urls {
        match parse_linear_title(url) {
            Some(title) => println!("✅ {} -> {}", url, title),
            None => match parse_custom_title(url) {
                Some(title) => println!("✅ {} -> {} (fallback)", url, title),
                None => println!("❌ {} -> Failed to parse", url),
            },
        }
    }

    // Test non-supported URLs
    println!("\n=== Non-supported URLs ===");
    let other_urls = ["https://google.com", "https://github.com"];

    for url in &other_urls {
        match parse_custom_title(url) {
            Some(title) => println!("❌ {} -> {} (unexpected result)", url, title),
            None => println!("✅ {} -> None (expected)", url),
        }
    }

    println!("\nAll tests completed!");
}
