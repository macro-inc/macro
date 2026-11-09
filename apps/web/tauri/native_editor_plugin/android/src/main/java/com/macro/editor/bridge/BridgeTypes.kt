// Generated from schema/bridge.schema.json; do not edit.
// To parse the JSON, install jackson-module-kotlin and do:
//
//   val nativeBridgeTypes = NativeBridgeTypes.fromJson(jsonString)

package com.macro.editor.bridge

import com.fasterxml.jackson.annotation.*
import com.fasterxml.jackson.core.*
import com.fasterxml.jackson.databind.*
import com.fasterxml.jackson.databind.deser.std.StdDeserializer
import com.fasterxml.jackson.databind.module.SimpleModule
import com.fasterxml.jackson.databind.node.*
import com.fasterxml.jackson.databind.ser.std.StdSerializer
import com.fasterxml.jackson.module.kotlin.*


@Suppress("UNCHECKED_CAST")
private fun <T> ObjectMapper.convert(k: kotlin.reflect.KClass<*>, fromJson: (JsonNode) -> T, toJson: (T) -> String, isUnion: Boolean = false) = registerModule(SimpleModule().apply {
    addSerializer(k.java as Class<T>, object : StdSerializer<T>(k.java as Class<T>) {
            override fun serialize(value: T, gen: JsonGenerator, provider: SerializerProvider) = gen.writeRawValue(toJson(value))
    })
    addDeserializer(k.java as Class<T>, object : StdDeserializer<T>(k.java as Class<T>) {
            override fun deserialize(p: JsonParser, ctxt: DeserializationContext) = fromJson(p.readValueAsTree())
    })
})

val mapper = jacksonObjectMapper().apply {
    propertyNamingStrategy = PropertyNamingStrategy.LOWER_CAMEL_CASE
    setSerializationInclusion(JsonInclude.Include.NON_NULL)
    convert(ActionRequestKind::class,        { ActionRequestKind.fromValue(it.asText()) },        { "\"${it.value}\"" })
    convert(CreateRequestAccess::class,      { CreateRequestAccess.fromValue(it.asText()) },      { "\"${it.value}\"" })
    convert(PresenceColor::class,            { PresenceColor.fromValue(it.asText()) },            { "\"${it.value}\"" })
    convert(Preset::class,                   { Preset.fromValue(it.asText()) },                   { "\"${it.value}\"" })
    convert(Transport::class,                { Transport.fromValue(it.asText()) },                { "\"${it.value}\"" })
    convert(Signal::class,                   { Signal.fromValue(it.asText()) },                   { "\"${it.value}\"" })
    convert(Block::class,                    { Block.fromValue(it.asText()) },                    { "\"${it.value}\"" })
    convert(ChoiceKind::class,               { ChoiceKind.fromValue(it.asText()) },               { "\"${it.value}\"" })
    convert(QueryRequestKind::class,         { QueryRequestKind.fromValue(it.asText()) },         { "\"${it.value}\"" })
    convert(SurfaceEventKind::class,         { SurfaceEventKind.fromValue(it.asText()) },         { "\"${it.value}\"" })
    convert(Action::class,                   { Action.fromValue(it.asText()) },                   { "\"${it.value}\"" })
    convert(QueryKind::class,                { QueryKind.fromValue(it.asText()) },                { "\"${it.value}\"" })
    convert(TokenResultRequestAccess::class, { TokenResultRequestAccess.fromValue(it.asText()) }, { "\"${it.value}\"" })
}

/**
 * Source of truth for the Android editor bridge. The root is a type catalog; commands carry
 * their named request, never this catalog.
 */
data class NativeBridgeTypes (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val accountReply: AccountReply,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val accountRequest: AccountRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val actionRequest: ActionRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val createRequest: CreateRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val focusRequest: FocusRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val layoutRequest: LayoutRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val lifecycleRequest: LifecycleRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val menuCommitRequest: MenuCommitRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val menuRowsRequest: MenuRowsRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val mountRequest: MountRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val permissionRequest: PermissionRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val queryReply: QueryReply,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val queryRequest: QueryRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val surfaceEvent: SurfaceEvent,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val surfacePermissions: SurfacePermissions,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val surfaceScope: SurfaceScope,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val tokenResultRequest: TokenResultRequest,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val unmountRequest: UnmountRequest
) {
    fun toJson() = mapper.writeValueAsString(this)

    companion object {
        fun fromJson(json: String) = mapper.readValue<NativeBridgeTypes>(json)
    }
}

data class AccountReply (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val accountGeneration: Long
)

data class AccountRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val user: String
)

data class ActionRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val kind: ActionRequestKind,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val modelGeneration: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val name: String,

    @get:JsonProperty("payloadJson")@field:JsonProperty("payloadJson")
    val payloadJSON: String? = null,

    val revision: Long? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope
)

enum class ActionRequestKind(val value: String) {
    Application("application"),
    Command("command"),
    SetState("setState");

    companion object {
        fun fromValue(value: String): ActionRequestKind = when (value) {
            "application" -> Application
            "command"     -> Command
            "setState"    -> SetState
            else          -> throw IllegalArgumentException()
        }
    }
}

data class SurfaceScope (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val accountGeneration: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val surfaceGeneration: Long,

    @get:JsonProperty("surfaceId", required=true)@field:JsonProperty("surfaceId", required=true)
    val surfaceID: String
)

data class CreateRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val access: CreateRequestAccess,

    @get:JsonProperty("documentId", required=true)@field:JsonProperty("documentId", required=true)
    val documentID: String,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val durable: Boolean,

    val hostname: String? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val permissions: SurfacePermissions,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val presenceColor: PresenceColor,

    @get:JsonProperty("presenceRefreshMs")@field:JsonProperty("presenceRefreshMs")
    val presenceRefreshMS: Long? = null,

    @get:JsonProperty("presenceTimeoutMs", required=true)@field:JsonProperty("presenceTimeoutMs", required=true)
    val presenceTimeoutMS: Long,

    @get:JsonProperty("presenceUserId")@field:JsonProperty("presenceUserId")
    val presenceUserID: String? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val preset: Preset,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope,

    @get:JsonProperty("sessionId", required=true)@field:JsonProperty("sessionId", required=true)
    val sessionID: String,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val snapshotBase64: String,

    @get:JsonProperty("snapshotIntervalMs", required=true)@field:JsonProperty("snapshotIntervalMs", required=true)
    val snapshotIntervalMS: Long,

    val traceparent: String? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val transport: Transport,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val user: String
)

enum class CreateRequestAccess(val value: String) {
    Comment("comment"),
    Edit("edit"),
    Read("read");

    companion object {
        fun fromValue(value: String): CreateRequestAccess = when (value) {
            "comment" -> Comment
            "edit"    -> Edit
            "read"    -> Read
            else      -> throw IllegalArgumentException()
        }
    }
}

data class SurfacePermissions (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val canComment: Boolean,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val canWrite: Boolean,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val contentInteractable: Boolean,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val current: Boolean,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val editorEditable: Boolean
)

enum class PresenceColor(val value: String) {
    Blue("blue"),
    Cyan("cyan"),
    Green("green"),
    Lime("lime"),
    Orange("orange"),
    Pink("pink"),
    Purple("purple"),
    Red("red"),
    Teal("teal"),
    Violet("violet"),
    Yellow("yellow");

    companion object {
        fun fromValue(value: String): PresenceColor = when (value) {
            "blue"   -> Blue
            "cyan"   -> Cyan
            "green"  -> Green
            "lime"   -> Lime
            "orange" -> Orange
            "pink"   -> Pink
            "purple" -> Purple
            "red"    -> Red
            "teal"   -> Teal
            "violet" -> Violet
            "yellow" -> Yellow
            else     -> throw IllegalArgumentException()
        }
    }
}

enum class Preset(val value: String) {
    Calendar("calendar"),
    Chat("chat"),
    Markdown("markdown"),
    MarkdownSync("markdownSync"),
    PlainText("plainText"),
    Title("title");

    companion object {
        fun fromValue(value: String): Preset = when (value) {
            "calendar"     -> Calendar
            "chat"         -> Chat
            "markdown"     -> Markdown
            "markdownSync" -> MarkdownSync
            "plainText"    -> PlainText
            "title"        -> Title
            else           -> throw IllegalArgumentException()
        }
    }
}

enum class Transport(val value: String) {
    Direct("direct"),
    None("none");

    companion object {
        fun fromValue(value: String): Transport = when (value) {
            "direct" -> Direct
            "none"   -> None
            else     -> throw IllegalArgumentException()
        }
    }
}

data class FocusRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val focused: Boolean,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val mountGeneration: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope
)

data class LayoutRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val clipBottom: Double,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val clipLeft: Double,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val clipRight: Double,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val clipTop: Double,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val height: Double,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val left: Double,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val mountGeneration: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val top: Double,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val viewportWidth: Double,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val visible: Boolean,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val width: Double
)

data class LifecycleRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val signal: Signal
)

enum class Signal(val value: String) {
    Hidden("hidden"),
    Online("online"),
    PageHide("pageHide"),
    Visible("visible");

    companion object {
        fun fromValue(value: String): Signal = when (value) {
            "hidden"   -> Hidden
            "online"   -> Online
            "pageHide" -> PageHide
            "visible"  -> Visible
            else       -> throw IllegalArgumentException()
        }
    }
}

data class MenuCommitRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val choice: MenuChoice,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val identity: MenuIdentity,

    @get:JsonProperty("rowId", required=true)@field:JsonProperty("rowId", required=true)
    val rowID: String,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope
)

data class MenuChoice (
    val agentSession: MenuAgentSession? = null,
    val block: Block? = null,
    val bookingLink: MenuBookingLink? = null,
    val date: MenuDate? = null,
    val document: MenuDocument? = null,
    val groupAlias: String? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val kind: ChoiceKind,

    @get:JsonProperty("snippetNodesJson")@field:JsonProperty("snippetNodesJson")
    val snippetNodesJSON: String? = null,

    val text: String? = null,
    val user: MenuUser? = null
)

data class MenuAgentSession (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val id: String,

    val label: String? = null,

    @get:JsonProperty("mentionUuid")@field:JsonProperty("mentionUuid")
    val mentionUUID: String? = null
)

enum class Block(val value: String) {
    Bullet("bullet"),
    Check("check"),
    Code("code"),
    Heading1("heading1"),
    Heading2("heading2"),
    Heading3("heading3"),
    Link("link"),
    Number("number"),
    Paragraph("paragraph"),
    Quote("quote");

    companion object {
        fun fromValue(value: String): Block = when (value) {
            "bullet"    -> Bullet
            "check"     -> Check
            "code"      -> Code
            "heading1"  -> Heading1
            "heading2"  -> Heading2
            "heading3"  -> Heading3
            "link"      -> Link
            "number"    -> Number
            "paragraph" -> Paragraph
            "quote"     -> Quote
            else        -> throw IllegalArgumentException()
        }
    }
}

data class MenuBookingLink (
    val label: String? = null,

    @get:JsonProperty("profileId")@field:JsonProperty("profileId")
    val profileID: String? = null,

    val slug: String? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val url: String
)

data class MenuDate (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val date: String,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val displayFormat: String,

    @get:JsonProperty("mentionUuid")@field:JsonProperty("mentionUuid")
    val mentionUUID: String? = null
)

data class MenuDocument (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val blockName: String,

    val blockParams: Map<String, String>? = null,
    val channelType: String? = null,
    val collapsed: Boolean? = null,
    val createdAt: Long? = null,

    @get:JsonProperty("documentId", required=true)@field:JsonProperty("documentId", required=true)
    val documentID: String,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val documentName: String,

    @get:JsonProperty("mentionUuid")@field:JsonProperty("mentionUuid")
    val mentionUUID: String? = null
)

enum class ChoiceKind(val value: String) {
    AgentSession("agent-session"),
    Block("block"),
    BookingLink("booking-link"),
    Date("date"),
    Document("document"),
    Group("group"),
    Snippet("snippet"),
    Text("text"),
    User("user");

    companion object {
        fun fromValue(value: String): ChoiceKind = when (value) {
            "agent-session" -> AgentSession
            "block"         -> Block
            "booking-link"  -> BookingLink
            "date"          -> Date
            "document"      -> Document
            "group"         -> Group
            "snippet"       -> Snippet
            "text"          -> Text
            "user"          -> User
            else            -> throw IllegalArgumentException()
        }
    }
}

data class MenuUser (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val displayName: String,

    val email: String? = null,

    @get:JsonProperty("mentionUuid")@field:JsonProperty("mentionUuid")
    val mentionUUID: String? = null,

    @get:JsonProperty("userId", required=true)@field:JsonProperty("userId", required=true)
    val userID: String
)

data class MenuIdentity (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val invocation: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val modelGeneration: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val mountGeneration: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val queryGeneration: Long
)

data class MenuRowsRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val buckets: List<MenuBucket>,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val identity: MenuIdentity,

    @get:JsonProperty("rejectedRowId")@field:JsonProperty("rejectedRowId")
    val rejectedRowID: String? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val rows: List<MenuRow>,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope
)

data class MenuBucket (
    val error: String? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val hasMore: Boolean,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val id: String,

    @get:JsonProperty("isLoading", required=true)@field:JsonProperty("isLoading", required=true)
    val isLoading: Boolean,

    @get:JsonProperty("isLoadingMore", required=true)@field:JsonProperty("isLoadingMore", required=true)
    val isLoadingMore: Boolean,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val label: String,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val loadedCount: Long
)

data class MenuRow (
    @get:JsonProperty("bucketId", required=true)@field:JsonProperty("bucketId", required=true)
    val bucketID: String,

    val detail: String? = null,
    val disabled: Boolean? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val id: String,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val label: String
)

data class MountRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val ariaLabel: String,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val darkMode: Boolean,

    @get:JsonProperty("fontSizeCssPx", required=true)@field:JsonProperty("fontSizeCssPx", required=true)
    val fontSizeCSSPx: Double,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val hintColorArgb: Long,

    @get:JsonProperty("lineHeightCssPx", required=true)@field:JsonProperty("lineHeightCssPx", required=true)
    val lineHeightCSSPx: Double,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val mountGeneration: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val placeholder: String,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val textColorArgb: Long
)

data class PermissionRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val permissions: SurfacePermissions,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope
)

data class QueryReply (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val json: String
)

data class QueryRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val kind: QueryRequestKind,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val modelGeneration: Long,

    val name: String? = null,

    @get:JsonProperty("payloadJson")@field:JsonProperty("payloadJson")
    val payloadJSON: String? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope
)

enum class QueryRequestKind(val value: String) {
    Application("application"),
    Clipboard("clipboard"),
    Markdown("markdown"),
    SavedState("savedState"),
    SelectedMarkdown("selectedMarkdown"),
    State("state"),
    Text("text");

    companion object {
        fun fromValue(value: String): QueryRequestKind = when (value) {
            "application"      -> Application
            "clipboard"        -> Clipboard
            "markdown"         -> Markdown
            "savedState"       -> SavedState
            "selectedMarkdown" -> SelectedMarkdown
            "state"            -> State
            "text"             -> Text
            else               -> throw IllegalArgumentException()
        }
    }
}

data class SurfaceEvent (
    val canRedo: Boolean? = null,
    val canUndo: Boolean? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val kind: SurfaceEventKind,

    val menu: MenuEvent? = null,
    val message: String? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val modelGeneration: Long,

    val name: String? = null,

    @get:JsonProperty("payloadJson")@field:JsonProperty("payloadJson")
    val payloadJSON: String? = null,

    @get:JsonProperty("requestId")@field:JsonProperty("requestId")
    val requestID: Long? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val revision: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope
)

enum class SurfaceEventKind(val value: String) {
    Changed("changed"),
    Error("error"),
    History("history"),
    Menu("menu"),
    Plugin("plugin"),
    Ready("ready"),
    Status("status"),
    Stopped("stopped"),
    Telemetry("telemetry"),
    Token("token");

    companion object {
        fun fromValue(value: String): SurfaceEventKind = when (value) {
            "changed"   -> Changed
            "error"     -> Error
            "history"   -> History
            "menu"      -> Menu
            "plugin"    -> Plugin
            "ready"     -> Ready
            "status"    -> Status
            "stopped"   -> Stopped
            "telemetry" -> Telemetry
            "token"     -> Token
            else        -> throw IllegalArgumentException()
        }
    }
}

data class MenuEvent (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val action: Action,

    @get:JsonProperty("bucketId")@field:JsonProperty("bucketId")
    val bucketID: String? = null,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val query: MenuQuery,

    @get:JsonProperty("rowId")@field:JsonProperty("rowId")
    val rowID: String? = null
)

enum class Action(val value: String) {
    Closed("closed"),
    More("more"),
    Query("query"),
    Select("select");

    companion object {
        fun fromValue(value: String): Action = when (value) {
            "closed" -> Closed
            "more"   -> More
            "query"  -> Query
            "select" -> Select
            else     -> throw IllegalArgumentException()
        }
    }
}

data class MenuQuery (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val identity: MenuIdentity,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val kind: QueryKind,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val nodeTypes: List<String>,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val selectedIndex: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val term: String
)

enum class QueryKind(val value: String) {
    Action("action"),
    Emoji("emoji"),
    Mention("mention"),
    Snippet("snippet");

    companion object {
        fun fromValue(value: String): QueryKind = when (value) {
            "action"  -> Action
            "emoji"   -> Emoji
            "mention" -> Mention
            "snippet" -> Snippet
            else      -> throw IllegalArgumentException()
        }
    }
}

data class TokenResultRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val access: TokenResultRequestAccess,

    @get:JsonProperty("requestId", required=true)@field:JsonProperty("requestId", required=true)
    val requestID: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope,

    @get:JsonProperty("socketUrl")@field:JsonProperty("socketUrl")
    val socketURL: String? = null,

    val token: String? = null
)

enum class TokenResultRequestAccess(val value: String) {
    CommentMarks("commentMarks"),
    Full("full"),
    None("none");

    companion object {
        fun fromValue(value: String): TokenResultRequestAccess = when (value) {
            "commentMarks" -> CommentMarks
            "full"         -> Full
            "none"         -> None
            else           -> throw IllegalArgumentException()
        }
    }
}

data class UnmountRequest (
    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val mountGeneration: Long,

    @get:JsonProperty(required=true)@field:JsonProperty(required=true)
    val scope: SurfaceScope
)

