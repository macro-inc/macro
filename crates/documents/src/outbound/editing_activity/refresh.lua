local admitted_event = redis.call('GET', KEYS[1])
if not admitted_event then
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    return 1
end

redis.call('EXPIRE', KEYS[1], ARGV[2])
return admitted_event == ARGV[1] and 1 or 0
