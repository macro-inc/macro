# MCP auth proxy

`mcp_auth_proxy` gives public MCP clients an OAuth broker in front of product login. `/authorize` creates a short-lived PKCE session and redirects the browser to the Macro app `/login?mcp_session=…`.

The frontend owns choosing Google or email OTP. After those tokens exist, it posts them to `/login/{session}/complete`. The broker returns the same tokens through its authorization-code and PKCE exchange at `/token`.
