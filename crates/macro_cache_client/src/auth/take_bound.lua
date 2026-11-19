-- Documented at TAKE_BOUND_MOBILE_LOGIN_SESSION in ../auth.rs.
local bound = redis.call('HMGET', KEYS[1], ARGV[1], ARGV[2])
if not bound[1] then
  return false
end
local expires_at_ms = deadline_ms(KEYS[1])
redis.call('DEL', KEYS[1])
if not bound[2] or expires_at_ms < 0 then
  return false
end
return {bound[1], expires_at_ms, bound[2]}
