package com.macro.editor

import android.os.Looper
import android.view.ContextThemeWrapper
import android.webkit.WebView
import android.widget.FrameLayout
import com.fasterxml.jackson.module.kotlin.readValue
import com.macro.editor.bridge.*
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeEditorSurfacesTest {
    @Test fun generatedBridgeRestoresSurfaceAndRejectsStaleAccountsAndContentWrites() {
        val context = ContextThemeWrapper(RuntimeEnvironment.getApplication(), androidx.appcompat.R.style.Theme_AppCompat)
        val web = WebView(context)
        val parent = FrameLayout(context)
        parent.addView(web)
        val events = mutableListOf<SurfaceEvent>()
        val client = OkHttpClient()
        val bridge = NativeEditorSurfaces(context, web, client, events::add)
        val account = bridge.beginAccount(AccountRequest("fixture-user"))
        val request = mapper.readValue<CreateRequest>("""{
          "scope":{"surfaceId":"fixture-surface","surfaceGeneration":1,"accountGeneration":${account.accountGeneration}},
          "documentId":"surface-fixture","sessionId":"00000000-0000-0000-0000-000000000041","user":"fixture-user",
          "preset":"markdownSync","access":"edit","transport":"none","durable":false,
          "snapshotBase64":"","snapshotIntervalMs":0,"presenceTimeoutMs":5000,"presenceColor":"blue",
          "permissions":{"current":true,"canWrite":true,"canComment":true,"editorEditable":true,"contentInteractable":true}
        }""")
        try {
            bridge.create(request)
            assertTrue(events.any { it.kind == SurfaceEventKind.Ready })
            val appearance = mapper.readValue<MountRequest>("""{
              "scope":{"surfaceId":"fixture-surface","surfaceGeneration":1,"accountGeneration":${account.accountGeneration}},
              "ariaLabel":"Fixture editor","placeholder":"","darkMode":false,"fontSizeCssPx":16,"lineHeightCssPx":24,
              "textColorArgb":4278190080,"hintColorArgb":4286611584
            }""")
            bridge.mount(appearance)
            val firstPlacement = parent.getChildAt(1)
            require(firstPlacement is FrameLayout)
            val staleEditor = firstPlacement.getChildAt(0)
            require(staleEditor is NativeEditorView)
            val state = """{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"a😀"}]}]}}"""
            bridge.action(ActionRequest(ActionRequestKind.SetState, 0, "state", state, null, request.scope))
            assertEquals("\"a😀\"", bridge.query(QueryRequest(QueryRequestKind.Text, 0, null, null, request.scope)).json)
            bridge.unmount(request.scope)
            bridge.mount(appearance)
            val secondPlacement = parent.getChildAt(1)
            require(secondPlacement is FrameLayout)
            val replacement = secondPlacement.getChildAt(0)
            require(replacement is NativeEditorView)
            replacement.setSelection(0, 3)
            staleEditor.setSelection(0, 1)
            assertFalse(staleEditor.onTextContextMenuItem(android.R.id.copy))
            assertEquals("\"a😀\"", bridge.query(QueryRequest(QueryRequestKind.SelectedMarkdown, 0, null, null, request.scope)).json)
            assertEquals("\"a😀\"", bridge.query(QueryRequest(QueryRequestKind.Markdown, 0, null, null, request.scope)).json)
            bridge.permissions(PermissionRequest(request.permissions.copy(contentInteractable = false), request.scope))
            assertThrows(IllegalArgumentException::class.java) {
                bridge.action(ActionRequest(ActionRequestKind.SetState, 0, "state", state, null, request.scope))
            }
            assertEquals("\"a😀\"", bridge.query(QueryRequest(QueryRequestKind.Text, 0, null, null, request.scope)).json)
            bridge.permissions(PermissionRequest(request.permissions.copy(current = false), request.scope))
            bridge.stop(request.scope)
            bridge.stop(request.scope)
            shadowOf(Looper.getMainLooper()).idle()
            bridge.stop(request.scope)
            assertEquals(1, events.count { it.kind == SurfaceEventKind.Stopped })
            assertThrows(IllegalArgumentException::class.java) { bridge.create(request) }
            bridge.beginAccount(AccountRequest("other-fixture-user"))
            assertThrows(IllegalArgumentException::class.java) { bridge.query(QueryRequest(QueryRequestKind.Text, 0, null, null, request.scope)) }
        } finally {
            bridge.dispose()
            shadowOf(Looper.getMainLooper()).idle()
            web.destroy()
            client.dispatcher.executorService.shutdownNow()
            client.connectionPool.evictAll()
        }
    }
}
