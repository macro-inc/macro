-- deadline_ms(key), documented at deadline_lua! in ../auth.rs.
local function deadline_ms(key)
  if (redis.REDIS_VERSION_NUM or 0) >= 0x070000 then
    return redis.call('PEXPIRETIME', key)
  end
  local now = redis.call('TIME')
  local ttl_ms = redis.call('PTTL', key)
  if ttl_ms < 0 then
    return ttl_ms
  end
  return now[1] * 1000 + math.floor(now[2] / 1000) + ttl_ms
end
