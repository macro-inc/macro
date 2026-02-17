This crate provides an implementation of durable streams. It's implemented using
redis, but is generic over two key traits.

The behavior of the traits is correct, but the implemenetation is flawed because: 

1. A scan is used to find active streams
This doesn't scale well and is slow. Instead we should use a postgres loookup table
to track active streams.

2. Streams are active until they're TTL expires
The frontend properly deduplicates streams. The synchronization model is intended to guarantee
that the frontend gets at least one of a stream or a message saved in the database. This model
may give the frontend both a stream and a db message. Prevent the frontend from
getting a stream. The from_asyn_stream method should also accept a close
delay parameter that delays the close call. 

I want you to update the redis implementation to use a postgres table to track active 
streams. You can rename the module from redis to redis_postgres. I also want a guarantee
that every redis stream has a timeout. The active streams call should check the table 
_and_ validate that the stream is active in reddis. If it's innactive in reddis the table
should be updated.
