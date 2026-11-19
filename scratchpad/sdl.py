import re,sys
p='static_assets/schema.graphql'
s=open(p).read()
types='''"""
One page of a channel's changes after a sequence number.
"""
type GraphqlChannelChanges {
	resetRequired: Boolean!
	seq: String!
	hasMore: Boolean!
	messages: [GraphqlChannelMessage!]!
	activities: [GraphqlChannelTimelineActivity!]!
	removedIds: [ID!]!
}

type GraphqlChannelBotProfile {
	name: String!
	avatarUrl: String
}

type GraphqlChannelMention {
	entityType: String!
	entityId: String!
}

type GraphqlChannelAttachment {
	attachmentId: ID!
	entityType: String!
	entityId: String!
	width: Int
	height: Int
	createdAt: String!
}

type GraphqlChannelReaction {
	emoji: String!
	users: [String!]!
}

enum GraphqlChannelCallState {
	LIVE
	ENDED
	RECORD_DELETED
}

type GraphqlChannelCallStatus {
	state: GraphqlChannelCallState!
	endedAt: String
	durationMs: Float
}

enum GraphqlChannelMessageKind {
	MESSAGE
	CALL_ROOT
}

type GraphqlChannelThread {
	resolved: Boolean!
	deletedAt: String
	createdAt: String!
	updatedAt: String!
	userId: String!
	replyCount: Int!
	latestReplyAt: String
	preview: [GraphqlChannelMessage!]!
}

"""
One channel message: a root with its thread summary, or a reply.
"""
type GraphqlChannelMessage {
	id: ID!
	channelId: ID!
	threadId: ID
	kind: GraphqlChannelMessageKind!
	sortKey: String!
	senderId: String!
	guestName: String
	importedAuthorName: String
	botProfile: GraphqlChannelBotProfile
	mentions: [GraphqlChannelMention!]!
	triggeredBy: String
	triggeredVia: String
	content: String!
	createdAt: String!
	updatedAt: String!
	editedAt: String
	deletedAt: String
	attachments: [GraphqlChannelAttachment!]!
	reactions: [GraphqlChannelReaction!]!
	thread: GraphqlChannelThread
	call: GraphqlChannelCallStatus
}

type GraphqlChannelTimelineActivity {
	id: ID!
	channelId: ID!
	sortKey: String!
	actorId: String!
	occurredAt: String!
	action: String!
	payload: JSON
}

union GraphqlChannelTimelineEntry = GraphqlChannelMessage | GraphqlChannelTimelineActivity

type GraphqlChannelTimelinePage {
	entries: [GraphqlChannelTimelineEntry!]!
	olderCursor: String
	newerCursor: String
	seq: String!
}

type GraphqlChannelThreadPage {
	root: GraphqlChannelMessage!
	replies: [GraphqlChannelMessage!]!
	olderCursor: String
	newerCursor: String
	seq: String!
}

input ChannelTimelineInput {
	channelId: ID!
	limit: Int
	before: String
	after: String
	around: ID
}

input ChannelThreadInput {
	channelId: ID!
	rootId: ID!
	limit: Int
	before: String
	after: String
	around: ID
}

input ChannelChangesInput {
	channelId: ID!
	after: String!
}

'''
anchor='"""\nOne bounded page of calendar changes after a watermark.\n"""\ntype GraphqlCalendarChanges {'
assert s.count(anchor)==1
s=s.replace(anchor,types+anchor)
f='\tcalendarChanges(input: CalendarChangesInput!): GraphqlCalendarChanges!\n'
assert s.count(f)==1
s=s.replace(f,f+'''	"""
	One page of a channel's timeline, newest first.
	"""
	channelTimeline(input: ChannelTimelineInput!): GraphqlChannelTimelinePage!
	"""
	One page of a thread's live replies with its root.
	"""
	channelThread(input: ChannelThreadInput!): GraphqlChannelThreadPage!
	"""
	The channel's changes after a sequence number, one bounded page at a time.
	"""
	channelChanges(input: ChannelChangesInput!): GraphqlChannelChanges!
	"""
	One channel message by id; null when it does not exist.
	"""
	channelMessage(channelId: ID!, messageId: ID!): GraphqlChannelMessage
''')
open(p,'w').write(s)
