local ended = redis.call('GET', KEYS[2])
if ended then return ended end
local current = redis.call('GET', KEYS[1])
if current then return current end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return false
