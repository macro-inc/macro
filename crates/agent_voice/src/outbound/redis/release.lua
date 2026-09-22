local current = redis.call('GET', KEYS[1])
if not current then return false end
local lease = cjson.decode(current)
if lease.voice_session_id ~= ARGV[1] then return false end
lease.state = 'Ending'
redis.call('SET', KEYS[2], cjson.encode(lease), 'EX', ARGV[2])
redis.call('DEL', KEYS[1])
return true
