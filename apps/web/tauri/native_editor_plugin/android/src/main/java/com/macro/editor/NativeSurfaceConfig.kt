package com.macro.editor

import com.macro.documentsession.*
import com.macro.editor.bridge.CreateRequest
import com.macro.editor.bridge.CreateRequestAccess
import com.macro.editor.bridge.Preset
import com.macro.editor.bridge.SurfaceScope
import com.macro.editor.bridge.Transport
import java.util.Locale

internal object NativeSurfaceConfig {
    fun scope(scope: SurfaceScope) {
        require(scope.surfaceID.isNotEmpty())
        require(scope.accountGeneration in 0..UInt.MAX_VALUE.toLong())
        require(scope.surfaceGeneration in 0..UInt.MAX_VALUE.toLong())
    }

    fun create(request: CreateRequest, peers: List<ULong>): FfiSessionConfig {
        scope(request.scope)
        require(request.permissions.current)
        require(request.snapshotIntervalMS in 0..UInt.MAX_VALUE.toLong())
        require(request.presenceTimeoutMS in 1..UInt.MAX_VALUE.toLong())
        request.presenceRefreshMS?.let { require(it in 1..UInt.MAX_VALUE.toLong()) }
        val defaults = syncDefaults()
        return FfiSessionConfig(
            SyncConfig(
                request.documentID, request.sessionID, request.user,
                when (request.transport) { Transport.Direct -> TransportKind.DIRECT; Transport.None -> TransportKind.NONE },
                if (request.durable) Persistence.DURABLE else Persistence.MEMORY,
                when (request.access) {
                    CreateRequestAccess.Read -> Access.READ
                    CreateRequestAccess.Comment -> Access.COMMENT_ONLY
                    CreateRequestAccess.Edit -> Access.EDIT
                },
                null, request.traceparent, defaults.timeouts, defaults.heartbeat, defaults.backoff,
                defaults.converge, defaults.wal,
                request.snapshotIntervalMS.takeIf { it > 0 }?.toULong(),
                PresencePolicy(request.presenceTimeoutMS, request.presenceRefreshMS?.toULong(),
                    PresenceUser(request.presenceUserID, PaletteColor.valueOf(request.presenceColor.value.uppercase(Locale.ROOT))),
                    PresenceKeyMode.Peer),
                false, defaults.resetBudget,
            ),
            peers, PeerRange.USER, ViewOs.ANDROID, false,
            FfiApplicationConfig(when (request.preset) {
                Preset.PlainText -> FfiEditorType.PLAIN_TEXT
                Preset.Title -> FfiEditorType.TITLE
                Preset.Markdown -> FfiEditorType.MARKDOWN
                Preset.MarkdownSync -> FfiEditorType.MARKDOWN_SYNC
                Preset.Chat -> FfiEditorType.CHAT
                Preset.Calendar -> FfiEditorType.CALENDAR
            }, request.hostname), emptyList(),
        )
    }
}
