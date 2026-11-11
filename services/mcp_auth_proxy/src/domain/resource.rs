//! The MCP servers the broker issues tokens for, named by the RFC 8707
//! `resource` a client asks for.

#[cfg(test)]
mod test;

/// An MCP server the broker issues tokens for. Each gets the token it can use.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum McpResource {
    /// The harness's public MCP. Gets the upstream FusionAuth access token;
    /// the harness labels what the client writes from the access token's
    /// recorded client.
    Harness,
    /// The ChatGPT MCP server. It passes its token straight to Macro's APIs,
    /// which cannot look up the client, so it gets a Macro API token that
    /// signs the attribution in.
    Chatgpt,
}

/// The `resource` URLs the broker knows, and which server each names.
#[derive(Clone, Debug)]
pub struct McpResources {
    harness: String,
    chatgpt: String,
}

impl McpResources {
    /// `harness` is the harness's public MCP transport URL, which its
    /// metadata advertises; `chatgpt` is the ChatGPT MCP server's.
    pub fn new(harness: String, chatgpt: String) -> Self {
        Self { harness, chatgpt }
    }

    /// The `resource` the harness's protected-resource metadata advertises.
    pub fn harness(&self) -> &str {
        &self.harness
    }

    /// The server a request's `resource` names: the ChatGPT server for its
    /// exact URL (a trailing slash aside), the harness for anything else.
    /// Deployed clients send whatever resource they derive from the URL their
    /// user configured, or none, and all of them are harness clients, so an
    /// unrecognized resource keeps the token they have always received.
    pub fn resolve(&self, resource: Option<&str>) -> McpResource {
        let names_chatgpt = resource.is_some_and(|resource| {
            resource.trim_end_matches('/') == self.chatgpt.trim_end_matches('/')
        });

        if names_chatgpt {
            McpResource::Chatgpt
        } else {
            McpResource::Harness
        }
    }
}
