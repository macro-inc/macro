# MCP auth proxy

`mcp_auth_proxy` gives public MCP clients an OAuth broker in front of FusionAuth. `/authorize` creates a short-lived session and opens a broker-hosted login page where the user can continue with Google or email OTP.

Both methods produce the same FusionAuth access and refresh tokens. The broker returns those tokens through its existing authorization-code and PKCE exchange at `/token`.
