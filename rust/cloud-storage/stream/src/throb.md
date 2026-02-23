We want to be able to get events about streams

The immediate feature is a "throbber" for AI agents that shows the 
status of a background agent.

This should be batched by default (not make request per stream)
  - it may be fine to just send a ws message per stream in soup to receive events about it

Multiple users may be able to see the same agent and need events for it. This means
that simply keying streams based on user Id doesn's solve the problem.

One possible API
  // this needs additional tracking bc streams are not stored per-user
  GET active_user_streams(user_id) -> StreamId[]
  WS_REQUEST notify(StreamId[])
  WS_RECEIVE Event { StreamId, Event }

  Tracking streams per user
    - Sharing makes this much harder
    - How do you track that a user has a stream id after share? 
    - Change stream ID to include user id is the most obvious thing but doesn't solve the 
    share case.

Another possible API  
  - On demand event streaming
  - Each user requests events for items
    - See an item
    - Request events
    - Get events
    - Change the stream repo `notify` method to return events rather than raw ids
    - Change close to post a close event
  This doesn't require any changes to StreamId (good), but may be less performant? Will
  each event subscription spawn a long-lived tokio task? Is this an easy way to 
  maliciously crash connection gateway? This also requires more frontend logic to 
  manage events streams.
