-- Every Linear MCP connection stored before the OAuth persistence fix
-- (#5107) and the DCR scope fix (#5153) is unrecoverable: refresh tokens
-- rotate on use, and the pre-fix client store never wrote the rotated
-- token back to the database, so the stored refresh token was orphaned
-- the moment it was first exercised. There is no code path that detects
-- or repairs this — the only fix is a full disconnect/reconnect. Wipe
-- every row so the next connection attempt starts clean instead of
-- failing silently against a dead credential.
DELETE FROM mcp_servers WHERE url = 'https://mcp.linear.app/mcp';
