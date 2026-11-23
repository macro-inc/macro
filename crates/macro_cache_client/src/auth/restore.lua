-- Documented at RESTORE_MOBILE_LOGIN_SESSION in ../auth.rs.
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
local now = redis.call('TIME')
local ttl_ms = tonumber(ARGV[2]) - (now[1] * 1000 + math.floor(now[2] / 1000))
if ttl_ms <= 0 then
  return 0
end
if ARGV[3] then
  redis.call('HSET', KEYS[1], ARGV[3], ARGV[1], ARGV[4], ARGV[5])
elseif (redis.REDIS_VERSION_NUM or 0) >= 0x070000 then
  redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[2])
else
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl_ms)
end
local pinned = redis.pcall('PEXPIREAT', KEYS[1], ARGV[2])
if type(pinned) == 'table' and pinned.err then
  redis.call('DEL', KEYS[1])
  return pinned
end
return redis.call('EXISTS', KEYS[1])
