-- One token bucket per key: up to ARGV[1] tokens, one more every ARGV[2] ms.
-- The hash holds the tokens left and when the bucket last gained one, in
-- Redis time, so every process sharing the key reads one clock. A bucket
-- that is full does not bank time, and an absent bucket starts full.
local capacity = tonumber(ARGV[1])
local refill_ms = tonumber(ARGV[2])
local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)

local state = redis.call('HMGET', KEYS[1], 'tokens', 'refilled_at')
local tokens = tonumber(state[1])
local refilled_at = tonumber(state[2])
if tokens == nil or refilled_at == nil then
  tokens = capacity
  refilled_at = now_ms
end

local gained = math.floor((now_ms - refilled_at) / refill_ms)
if gained > 0 then
  tokens = math.min(capacity, tokens + gained)
  refilled_at = refilled_at + gained * refill_ms
end
if tokens >= capacity then
  refilled_at = now_ms
end

local taken = 0
local retry_after_ms = 0
if tokens > 0 then
  tokens = tokens - 1
  taken = 1
else
  retry_after_ms = refilled_at + refill_ms - now_ms
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'refilled_at', refilled_at)
redis.call('PEXPIRE', KEYS[1], capacity * refill_ms)
return {taken, tokens, retry_after_ms}
