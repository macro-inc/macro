package com.macro.editor

import android.content.Context
import android.content.res.Configuration
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.view.ContextThemeWrapper
import android.webkit.WebView
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import com.macro.documentsession.*
import com.macro.editor.bridge.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.security.SecureRandom
import java.util.Locale

/** Owns account/surface generations; a WebView mount never becomes the document model. */
internal class NativeEditorSurfaces(
    private val context: Context,
    private val webView: WebView,
    private val client: OkHttpClient,
    private val publish: (SurfaceEvent) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val surfaces = linkedMapOf<String, Surface>()
    private val latestGenerations = mutableMapOf<String, Long>()
    private val retiring = mutableSetOf<Surface>()
    private var accountGeneration = 0L
    private var user: String? = null
    private var disposed = false
    private var afterDrain: (() -> Unit)? = null

    fun beginAccount(request: AccountRequest): AccountReply {
        checkMain()
        check(!disposed)
        require(request.user.isNotEmpty())
        require(accountGeneration < UInt.MAX_VALUE.toLong())
        surfaces.values.toList().forEach(::retire)
        surfaces.clear()
        latestGenerations.clear()
        accountGeneration++
        user = request.user
        return AccountReply(accountGeneration)
    }

    fun create(request: CreateRequest) {
        checkMain()
        validate(request.scope)
        require(request.user == user) { "Account generation does not own this user" }
        surfaces[request.scope.surfaceID]?.let { if (it.request == request) return }
        latestGenerations[request.scope.surfaceID]?.let {
            require(request.scope.surfaceGeneration > it) { "Surface generation is not newer" }
        }
        val surface = Surface(request)
        surfaces[request.scope.surfaceID]?.let { previous ->
            retire(previous)
        }
        surfaces[request.scope.surfaceID] = surface
        latestGenerations[request.scope.surfaceID] = request.scope.surfaceGeneration
        surface.host.admit(FfiInput.Start)
        surface.host.admit(FfiInput.Authorization(AuthorizationState(
            request.permissions.current, request.permissions.canWrite, request.permissions.canComment)))
        if (!request.durable) surface.offerSeed()
    }

    fun mount(request: MountRequest) {
        val surface = current(request.scope)
        require(request.textColorArgb in 0..UInt.MAX_VALUE.toLong() && request.hintColorArgb in 0..UInt.MAX_VALUE.toLong())
        require(request.fontSizeCSSPx.isFinite() && request.fontSizeCSSPx > 0)
        require(request.lineHeightCSSPx.isFinite() && request.lineHeightCSSPx > 0)
        surface.mountRequest = request
        if (surface.initialized) surface.mount()
    }

    fun layout(request: LayoutRequest) {
        val surface = current(request.scope)
        val bounds = EditorBounds(request.left, request.top, request.width, request.height,
            request.viewportWidth, request.clipLeft, request.clipTop, request.clipRight, request.clipBottom, request.visible)
        surface.bounds = bounds
        surface.placement?.update(request.scope.surfaceGeneration, bounds)
        surface.applyFocus()
    }

    fun focus(request: FocusRequest) {
        val surface = current(request.scope)
        surface.pendingFocus = request.focused
        surface.applyFocus()
    }

    fun permissions(request: PermissionRequest) {
        val surface = current(request.scope)
        if (surface.permissions != request.permissions) surface.revision++
        surface.permissions = request.permissions
        surface.host.admit(FfiInput.Authorization(AuthorizationState(request.permissions.current,
            request.permissions.canWrite, request.permissions.canComment)))
        surface.editor?.setContentInteractable(request.permissions.contentInteractable)
        surface.editor?.setEditable(request.permissions.editorEditable)
        if (!request.permissions.current) retire(surface)
    }

    fun token(request: TokenResultRequest) {
        val surface = current(request.scope)
        val completion = surface.tokens[request.requestID] ?: return
        if (request.token != null) {
            val url = requireNotNull(request.socketURL) { "Authorized token requires its source socket URL" }
            Request.Builder().url(url).build()
            surface.urls[request.token] = url
        }
        surface.tokens.remove(request.requestID)
        completion(request.token, when (request.access) {
            TokenResultRequestAccess.Full -> WriteAccess.FULL
            TokenResultRequestAccess.CommentMarks -> WriteAccess.COMMENT_MARKS
            TokenResultRequestAccess.None -> WriteAccess.NONE
        })
    }

    fun action(request: ActionRequest) {
        val surface = current(request.scope)
        require(request.modelGeneration == surface.modelGeneration.toLong()) { "Model generation changed" }
        request.revision?.let { require(it == surface.revision) { "Surface revision changed" } }
        require(surface.permissions.current && surface.permissions.editorEditable && surface.permissions.contentInteractable) {
            "Surface content is not interactable"
        }
        when (request.kind) {
            ActionRequestKind.SetState -> surface.host.admit(FfiInput.SetState(BridgeJson.root(requireNotNull(request.payloadJSON))))
            ActionRequestKind.Application -> surface.host.applicationCommand(request.name,
                BridgeJson.parse(request.payloadJSON ?: "{}"), surface.modelGeneration)
            ActionRequestKind.Command -> {
                val payload = mapper.readTree(request.payloadJSON ?: "{}")
                val command = when (request.name) {
                    "insertText" -> FfiCommand.InsertText(requireNotNull(payload.get("text")).also { require(it.isTextual) }.textValue())
                    "insertParagraph" -> FfiCommand.InsertParagraph
                    "insertLineBreak" -> FfiCommand.InsertLineBreak(false)
                    "selectAll" -> FfiCommand.SelectAll
                    "undo" -> FfiCommand.Undo
                    "redo" -> FfiCommand.Redo
                    "clear" -> FfiCommand.ClearEditor
                    "indent" -> FfiCommand.Indent
                    "outdent" -> FfiCommand.Outdent
                    "formatText" -> FfiCommand.FormatText(TextFormatType.valueOf(
                        requireNotNull(payload.get("format")).also { require(it.isTextual) }.textValue().uppercase(Locale.ROOT)))
                    else -> throw IllegalArgumentException("Unknown native editing command")
                }
                surface.host.admit(FfiInput.Command(command, ViewSelection.KeepModel))
            }
        }
    }

    fun query(request: QueryRequest): QueryReply {
        val surface = current(request.scope)
        require(request.modelGeneration == surface.modelGeneration.toLong()) { "Model generation changed" }
        val json = when (request.kind) {
            QueryRequestKind.Text -> mapper.writeValueAsString(surface.session.textContent())
            QueryRequestKind.Markdown -> mapper.writeValueAsString(surface.session.markdown(FfiMarkdownFlavor.APPLICATION))
            QueryRequestKind.State -> BridgeJson.state((surface.session.query(FfiQuery.State) as FfiQueryReply.State).root)
            QueryRequestKind.SavedState -> BridgeJson.stringify((surface.session.query(FfiQuery.SavedState) as FfiQueryReply.Value).value)
            QueryRequestKind.SelectedMarkdown -> mapper.writeValueAsString((surface.session.query(
                FfiQuery.SelectedMarkdown(FfiMarkdownFlavor.APPLICATION)) as FfiQueryReply.Text).text)
            QueryRequestKind.Clipboard -> mapper.writeValueAsString((surface.session.query(FfiQuery.Clipboard) as FfiQueryReply.Clipboard).entries)
            QueryRequestKind.Application -> BridgeJson.stringify(surface.session.applicationQuery(requireNotNull(request.name),
                BridgeJson.parse(request.payloadJSON ?: "{}"), surface.modelGeneration))
        }
        return QueryReply(json)
    }

    fun lifecycle(request: LifecycleRequest) {
        current(request.scope).host.admit(FfiInput.Host(when (request.signal) {
            Signal.Visible -> HostSignal.VISIBLE
            Signal.Hidden -> HostSignal.HIDDEN
            Signal.Online -> HostSignal.ONLINE
            Signal.PageHide -> HostSignal.PAGE_HIDE
        }))
    }

    fun lifecycle(signal: HostSignal) {
        checkMain()
        surfaces.values.toList().forEach { it.host.admit(FfiInput.Host(signal)) }
    }

    fun hasAccount(generation: Long) = surfaces.values.any { it.request.scope.accountGeneration == generation } ||
        retiring.any { it.request.scope.accountGeneration == generation }

    fun unmount(scope: SurfaceScope) { current(scope).unmount() }
    fun stop(scope: SurfaceScope) { retire(current(scope)) }

    fun dispose(onDrained: () -> Unit = {}) {
        checkMain()
        if (disposed) return
        disposed = true
        afterDrain = onDrained
        surfaces.values.toList().forEach(::retire)
        surfaces.clear()
        finishDispose()
    }

    private fun finishDispose() {
        if (disposed && surfaces.isEmpty() && retiring.isEmpty()) {
            val done = afterDrain
            afterDrain = null
            done?.invoke()
        }
    }

    private fun validate(scope: SurfaceScope) {
        checkMain()
        check(!disposed)
        NativeSurfaceConfig.scope(scope)
        require(scope.accountGeneration == accountGeneration && user != null) { "Stale account generation" }
    }

    private fun current(scope: SurfaceScope): Surface {
        validate(scope)
        return requireNotNull(surfaces[scope.surfaceID]).also {
            require(it.request.scope == scope && !it.closing) { "Stale surface generation" }
        }
    }

    private fun retire(surface: Surface) {
        if (surface.closing) return
        surface.closing = true
        surface.unmount()
        if (surfaces[surface.request.scope.surfaceID] === surface) surfaces.remove(surface.request.scope.surfaceID)
        retiring.add(surface)
        surface.host.stop(1u)
    }

    private inner class Surface(val request: CreateRequest) {
        var revision = 0L
        var modelGeneration = 0u
        var initialized = false
        var closing = false
        var permissions = request.permissions
        var mountRequest: MountRequest? = null
        var editor: NativeEditorView? = null
        var placement: EditorMount? = null
        var bounds: EditorBounds? = null
        var pendingFocus: Boolean? = null
        val tokens = mutableMapOf<Long, (String?, WriteAccess) -> Unit>()
        val urls = mutableMapOf<String, String>()
        private var nextToken = 0L
        private var offeredSeed = false
        private val entropy = SecureRandom()
        private val issuedPeers = mutableSetOf<ULong>()
        private val initialSnapshot = Base64.decode(request.snapshotBase64, Base64.DEFAULT)
        val session = NativeEditorSession(NativeSurfaceConfig.create(request, peers()), null, now())
        private val store = try {
            if (request.durable) NativeSessionStorage(context.applicationContext,
                request.documentID, request.sessionID, request.user) else null
        } catch (error: Exception) { session.close(); throw error }
        private val adapters = NativeSessionAdapters(store, object : NativeTokenSource {
            override fun fetch(doc: SyncDocId, complete: (String?, WriteAccess) -> Unit) {
                require(doc == request.documentID)
                require(nextToken < UInt.MAX_VALUE.toLong())
                nextToken++
                tokens[nextToken] = complete
                emit(SurfaceEventKind.Token, requestID = nextToken)
            }
            override fun close() { tokens.clear(); urls.clear() }
        }, client, { effect ->
            require(effect.doc == request.documentID)
            Request.Builder().url(requireNotNull(urls[effect.token]) { "Missing source socket URL" }).build()
        }, ::peers, { record ->
            emit(SurfaceEventKind.Telemetry, name = record.kind.javaClass.simpleName,
                payload = mapper.writeValueAsString(record))
        })
        private val effects = object : NativeSessionEffects by adapters {
            override fun storage(effect: FfiIoEffect.Storage, complete: (FfiStorageResult) -> Unit) {
                adapters.storage(effect) { result ->
                    complete(result)
                    if (effect.opBody is StorageOp.Load) handler.post { if (!closing) offerSeed() }
                }
            }
        }
        val host = NativeSessionHost(session, effects, {}, {
            emit(SurfaceEventKind.Error, message = it.javaClass.simpleName)
        }, ::now, ::observe)

        fun offerSeed() {
            if (offeredSeed || closing) return
            offeredSeed = true
            if (initialSnapshot.isNotEmpty() || request.transport == Transport.None) {
                host.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, initialSnapshot))
            }
        }

        private fun peers(): List<ULong> = buildList {
            while (size < 4) {
                val peer = (entropy.nextLong() and Long.MAX_VALUE).toULong()
                if (peer != 0uL && issuedPeers.add(peer)) add(peer)
            }
        }

        fun mount() {
            val appearance = mountRequest ?: return
            unmount()
            val configuration = Configuration(context.resources.configuration)
            configuration.uiMode = (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
                if (appearance.darkMode) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
            val themed = ContextThemeWrapper(context.createConfigurationContext(configuration),
                androidx.appcompat.R.style.Theme_AppCompat_DayNight)
            val view = NativeEditorView(themed, session, host, permissions.editorEditable, permissions.contentInteractable)
            view.hint = appearance.placeholder
            view.setTextColor(appearance.textColorArgb.toInt())
            view.setHintTextColor(appearance.hintColorArgb.toInt())
            view.includeFontPadding = false
            ViewCompat.setAccessibilityDelegate(view, object : AccessibilityDelegateCompat() {
                override fun onInitializeAccessibilityNodeInfo(hostView: android.view.View, info: AccessibilityNodeInfoCompat) {
                    super.onInitializeAccessibilityNodeInfo(hostView, info)
                    info.hintText = appearance.ariaLabel
                }
            })
            host.attach(view)
            editor = view
            placement = EditorMount(webView, view, request.scope.surfaceGeneration,
                appearance.fontSizeCSSPx, appearance.lineHeightCSSPx)
            bounds?.let { placement?.update(request.scope.surfaceGeneration, it) }
            applyFocus()
        }

        fun applyFocus() {
            pendingFocus?.let {
                if (placement?.focus(request.scope.surfaceGeneration, it) == true) pendingFocus = null
            }
        }

        fun unmount() {
            editor?.let(host::detach)
            placement?.close()
            placement = null
            editor = null
        }

        private fun observe(output: FfiOutput) {
            if (output.view.any { it is FfiViewEffect.Diff || it is FfiViewEffect.CommitTags || it is FfiViewEffect.SetSelection }) revision++
            for (effect in output.view) {
                when (effect) {
                    is FfiViewEffect.Initialize -> {
                        modelGeneration = effect.diff.generation
                        initialized = true
                        if (!closing) mount()
                        emit(SurfaceEventKind.Ready)
                    }
                    is FfiViewEffect.Diff -> { modelGeneration = effect.diff.generation; emit(SurfaceEventKind.Changed) }
                    is FfiViewEffect.TextContentChanged -> emit(SurfaceEventKind.Changed)
                    is FfiViewEffect.HistoryState -> emit(SurfaceEventKind.History,
                        canUndo = effect.availability.canUndo, canRedo = effect.availability.canRedo)
                    is FfiViewEffect.PluginEvent -> emit(SurfaceEventKind.Plugin, name = effect.name,
                        payload = effect.payload?.let(BridgeJson::stringify))
                    is FfiViewEffect.Status -> emit(SurfaceEventKind.Status, payload = mapper.writeValueAsString(effect.status))
                    is FfiViewEffect.Error -> emit(SurfaceEventKind.Error, message = effect.message)
                    is FfiViewEffect.Reply -> if (effect.reply is FfiReply.Stopped) {
                        retiring.remove(this)
                        if (surfaces[request.scope.surfaceID] === this) surfaces.remove(request.scope.surfaceID)
                        emit(SurfaceEventKind.Stopped)
                        handler.post(::finishDispose)
                    }
                    else -> Unit
                }
            }
        }

        private fun emit(kind: SurfaceEventKind, name: String? = null, payload: String? = null,
            requestID: Long? = null, canUndo: Boolean? = null, canRedo: Boolean? = null, message: String? = null) {
            if (!disposed && (!closing || kind == SurfaceEventKind.Stopped)) publish(SurfaceEvent(
                canRedo, canUndo, kind, message, modelGeneration.toLong(), name, payload, requestID, revision, request.scope))
        }
    }

    private fun now() = FfiNow(SystemClock.elapsedRealtime().toULong(), System.currentTimeMillis())
    private fun checkMain() = check(Looper.myLooper() == Looper.getMainLooper())
}
