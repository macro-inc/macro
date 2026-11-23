-- Documented at TAKE_UNBOUND_MOBILE_LOGIN_SESSION in ../auth.rs.
local refresh_token = redis.call('GET', KEYS[1])
if not refresh_token then
  return false
end
local expires_at_ms = deadline_ms(KEYS[1])
redis.call('DEL', KEYS[1])
if expires_at_ms < 0 then
  return false
end
return {refresh_token, expires_at_ms}
