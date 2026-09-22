local current = redis.call('GET', KEYS[1])
if not current then return false end
local lease = cjson.decode(current)
if lease.voice_session_id ~= ARGV[1] or lease.state ~= ARGV[2] then return false end
lease.state = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(lease), 'KEEPTTL')
return true
