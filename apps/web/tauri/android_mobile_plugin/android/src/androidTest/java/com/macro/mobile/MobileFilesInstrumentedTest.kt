package com.macro.mobile

import android.app.Activity
import android.content.ClipData
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONArray
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ShareTestActivity : Activity()

/** Isolated instrumentation-only provider: no production bridge/test commands. */
class ShareTestProvider : ContentProvider() {
    override fun onCreate() = true
    override fun getType(uri: Uri): String? = if (uri.lastPathSegment == "unknown") null else "application/octet-stream"
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
        if (uri.lastPathSegment == "denied") throw SecurityException("Provider refused access")
        return MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)).apply {
            addRow(arrayOf(if (uri.lastPathSegment == "unknown") "manual.pdf" else "../../漢字😀.bin", Long.MAX_VALUE))
        }
    }
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (uri.lastPathSegment == "missing") throw FileNotFoundException("Provider item removed")
        val pipe = ParcelFileDescriptor.createReliablePipe()
        Thread {
            try {
                ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { output ->
                    val bytes = ByteArray(64 * 1024) { (it % 251).toByte() }
                    val chunks = if (uri.lastPathSegment == "large") 512 else 1
                    repeat(chunks) { output.write(bytes) }
                }
            } catch (_: Exception) { pipe[1].closeWithError("Provider disconnected") }
        }.start()
        return pipe[0]
    }
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}

@RunWith(AndroidJUnit4::class)
class MobileFilesInstrumentedTest {
    private lateinit var scenario: ActivityScenario<ShareTestActivity>
    private lateinit var activity: Activity
    private lateinit var files: MobileFiles
    private fun uri(name: String) = Uri.parse("content://com.macro.mobile.test.provider/$name")
    private fun receive(intent: Intent) {
        val done = CountDownLatch(1)
        files.receive(intent) { done.countDown() }
        assertTrue("Provider copy timed out", done.await(30, TimeUnit.SECONDS))
    }
    private fun send(name: String) = Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uri(name))
    private fun pending() = files.readPendingShares().getJSONArray("files")
    private fun tokens(items: JSONArray) = (0 until items.length()).map { items.getJSONObject(it).getString("token") }.toSet()

    @Before fun setup() {
        scenario = ActivityScenario.launch(ShareTestActivity::class.java)
        scenario.onActivity { activity = it }
        for (name in listOf("android-share-inbox", "ios-share-staging", "ios-pasteboard-staging")) File(activity.cacheDir, name).deleteRecursively()
        files = MobileFiles(activity)
    }
    @After fun cleanup() { files.close(); scenario.close() }

    @Test fun multipleStreamsDeduplicateClipDataAndKeepText() {
        val first = uri("one")
        val second = uri("two")
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(first, second))
            clipData = ClipData.newUri(activity.contentResolver, "files", first).apply { addItem(ClipData.Item(second)) }
            putExtra(Intent.EXTRA_TEXT, "https://example.com/漢字 😀")
        }
        receive(intent)
        val items = pending()
        assertEquals(3, items.length())
        assertEquals(3, tokens(items).size)
        for (index in 0..1) {
            val item = items.getJSONObject(index)
            assertEquals("漢字😀.bin", item.getString("name"))
            assertEquals(65536, item.getLong("size"))
            val bytes = File(item.getString("previewPath")).readBytes()
            assertArrayEquals(ByteArray(65536) { (it % 251).toByte() }, bytes)
            assertEquals(MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }, item.getString("sha256"))
        }
        assertEquals("https://example.com/漢字 😀", items.getJSONObject(2).getString("sharedText"))
        files.acknowledge(tokens(items))
        assertEquals(0, pending().length())
        assertTrue(File(activity.cacheDir, "ios-share-staging").listFiles()!!.isEmpty())
    }

    @Test fun keepsQueueAcrossRecreationAndDelayedConsumption() {
        receive(send("one"))
        val first = pending()
        receive(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_TEXT, "second"))
        files.close()
        files = MobileFiles(activity)
        assertEquals(tokens(first), tokens(pending()))
        files.acknowledge(tokens(first))
        val next = pending()
        assertEquals("second", next.getJSONObject(0).getString("sharedText"))
        files.acknowledge(tokens(next))
        assertEquals(0, pending().length())
    }

    @Test fun providerFailureIsAtomicAndSurvivesDelayedFrontendStartup() {
        receive(Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(uri("one"), uri("missing"))))
        files.close()
        files = MobileFiles(activity)
        val snapshot = files.readPendingShares()
        assertTrue(snapshot.has("error"))
        assertEquals(0, snapshot.getJSONArray("files").length())
        assertTrue(File(activity.cacheDir, "ios-share-staging").listFiles()!!.isEmpty())
        assertFalse(files.readPendingShares().has("error"))
        receive(send("denied"))
        assertTrue(files.readPendingShares().has("error"))
    }

    @Test fun missingOrCorruptFirstBatchDoesNotBlockNextShare() {
        receive(send("one"))
        val first = pending().getJSONObject(0)
        File(first.getString("previewPath")).delete()
        receive(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_TEXT, "next"))
        val snapshot = files.readPendingShares()
        assertTrue(snapshot.has("error"))
        assertEquals("next", snapshot.getJSONArray("files").getJSONObject(0).getString("sharedText"))
        files.acknowledge(tokens(snapshot.getJSONArray("files")))
        File(activity.cacheDir, "android-share-inbox/broken.json").writeText("{")
        receive(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_TEXT, "after corruption"))
        assertEquals("after corruption", pending().getJSONObject(0).getString("sharedText"))
    }

    @Test fun streamsLargeProviderWithUntrustedSizeAndInfersMissingMime() {
        receive(send("large"))
        val item = pending().getJSONObject(0)
        assertEquals(32L * 1024 * 1024, item.getLong("size"))
        assertEquals(item.getLong("size"), File(item.getString("previewPath")).length())
        files.acknowledge(setOf(item.getString("token")))
        receive(send("unknown"))
        assertEquals("application/pdf", pending().getJSONObject(0).getString("mimeType"))
    }

    @Test fun rejectsUnsafeSchemesAndDeletesPartialOversizedCopies() {
        receive(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, Uri.parse("file:///sdcard/private.txt")))
        assertTrue(files.readPendingShares().has("error"))
        val output = File(activity.cacheDir, "oversized.bin")
        assertThrows(IllegalArgumentException::class.java) {
            MobileFiles.copyBounded(ByteArrayInputStream(ByteArray(4097)), output, 4096)
        }
        assertFalse(output.exists())
        val name = MobileFiles.safeName("漢😀".repeat(100))
        assertTrue(name.toByteArray().size <= 180)
        assertFalse(name.contains('�'))
    }
}
