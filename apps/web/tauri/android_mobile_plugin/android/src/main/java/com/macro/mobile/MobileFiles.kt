package com.macro.mobile

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

@InvokeArg
class TokensArgs { var tokens: List<String> = emptyList() }

/** Copies granted content URIs while their grant is alive. Never resolves a URI
 * to an external filesystem path, nor trusts provider names or reported sizes. */
class MobileFiles(private val activity: Activity) {
    private val worker = Executors.newSingleThreadExecutor()
    private val inbox = File(activity.cacheDir, "android-share-inbox")
    // These directories/token prefixes are the existing Rust streaming-upload contract.
    private val shares = File(activity.cacheDir, "ios-share-staging")
    private val pasteboard = File(activity.cacheDir, "ios-pasteboard-staging")
    private val errorFile = File(inbox, "last-error.txt")

    companion object {
        const val MAX_FILE_BYTES = 500L * 1024 * 1024
        private const val MAX_TEXT_CHARS = 1024 * 1024
        private const val MAX_FILES = 100
        private const val TTL_MS = 24L * 60 * 60 * 1000

        fun safeName(name: String): String {
            val clean = name.substringAfterLast('/').substringAfterLast('\\')
                .replace(Regex("[\\p{Cntrl}]"), "_")
            if (clean.isBlank() || clean == "." || clean == "..") return "attachment"
            // Android filenames are byte-limited; keep Unicode code points intact.
            val result = StringBuilder()
            var index = 0
            var bytes = 0
            while (index < clean.length) {
                val point = clean.codePointAt(index)
                val next = String(Character.toChars(point))
                bytes += next.toByteArray(Charsets.UTF_8).size
                if (bytes > 180) break
                result.append(next)
                index += Character.charCount(point)
            }
            return result.toString()
        }

        fun copyBounded(input: InputStream, destination: File, maxBytes: Long = MAX_FILE_BYTES) {
            try {
                destination.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        require(total <= maxBytes) { "Shared attachments exceed 500 MB" }
                        output.write(buffer, 0, count)
                    }
                }
            } catch (error: Exception) {
                destination.delete()
                throw error
            }
        }
    }

    private fun stage(uri: Uri, directory: File, prefix: String, maxBytes: Long = MAX_FILE_BYTES): JSONObject {
        require(uri.scheme == "content") { "Only content attachments are supported" }
        val resolver = activity.contentResolver
        val displayName = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
        val name = safeName(displayName ?: "attachment")
        val type = resolver.getType(uri)?.takeIf { it.isNotBlank() }
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"
        val token = prefix + UUID.randomUUID().toString().replace("-", "")
        directory.mkdirs()
        val file = File(directory, "$token-$name")
        val input = resolver.openInputStream(uri) ?: error("Attachment is unavailable")
        val digest = MessageDigest.getInstance("SHA-256")
        DigestInputStream(input, digest).use { copyBounded(it, file, maxBytes) }
        return JSONObject().apply {
            put("token", token)
            put("name", name)
            put("mimeType", type)
            put("size", file.length())
            put("previewPath", file.absolutePath)
            put("sha256", digest.digest().joinToString("") { "%02x".format(it) })
        }
    }

    fun receive(intent: Intent, done: (String?) -> Unit) {
        worker.execute {
            val staged = mutableListOf<JSONObject>()
            try {
                cleanup()
                val uris = linkedSetOf<Uri>()
                if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
                    IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
                        ?.let { uris.addAll(it) }
                } else {
                    IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
                        ?.let { uris.add(it) }
                }
                intent.clipData?.let { clip ->
                    for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let { uris.add(it) }
                }
                require(uris.size <= MAX_FILES) { "Too many attachments" }
                var remainingBytes = MAX_FILE_BYTES
                for (uri in uris) {
                    val item = stage(uri, shares, "share-stage-", remainingBytes)
                    staged.add(item)
                    remainingBytes -= item.getLong("size")
                }
                intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf { it.isNotBlank() }?.let { text ->
                    require(text.length <= MAX_TEXT_CHARS) { "Shared text is too large" }
                    val token = "share-stage-" + UUID.randomUUID().toString().replace("-", "")
                    staged.add(JSONObject().apply {
                        put("token", token)
                        put("name", "Shared text")
                        put("mimeType", "text/plain")
                        put("size", text.toByteArray().size)
                        put("isSharedText", true)
                        put("sharedText", text)
                    })
                }
                require(staged.isNotEmpty()) { "The share contains no readable content" }
                inbox.mkdirs()
                // One atomic manifest per incoming batch; readers never see partial copies.
                val batch = UUID.randomUUID().toString()
                val temporary = File(inbox, "$batch.tmp")
                temporary.writeText(JSONArray(staged).toString())
                check(temporary.renameTo(File(inbox, "$batch.json")))
                done(null)
            } catch (error: Exception) {
                staged.forEach { item -> stagedPath(item)?.delete() }
                val message = error.message ?: "Unable to read shared attachments"
                // A cold-start failure can precede the JS listener or login.
                // Keep it until the frontend has a chance to display it.
                try {
                    recordError(message)
                    done(null)
                } catch (_: Exception) { done(message) }
            }
        }
    }

    private fun stagedPath(item: JSONObject): File? {
        if (item.optBoolean("isSharedText")) return null
        val token = item.getString("token")
        require(Regex("share-stage-[a-f0-9]{32}").matches(token)) { "Invalid shared attachment" }
        return File(shares, "$token-${safeName(item.getString("name"))}")
    }

    private fun manifests(): List<File> = inbox.listFiles()
        ?.filter { it.extension == "json" }?.sortedBy { it.lastModified() } ?: emptyList()

    private fun cleanup() {
        val cutoff = System.currentTimeMillis() - TTL_MS
        for (directory in listOf(inbox, shares, pasteboard)) {
            directory.listFiles()?.filter { it.isFile && it.lastModified() < cutoff }?.forEach { it.delete() }
        }
    }

    private fun recordError(message: String) {
        inbox.mkdirs()
        errorFile.writeText(message)
    }

    /** Called on the serial worker; never expose half of a missing batch. */
    internal fun readPendingShares(): JSObject {
        cleanup()
        var files = JSONArray()
        for (manifest in manifests()) {
            var items: JSONArray? = null
            try {
                items = JSONArray(manifest.readText())
                check(items.length() > 0)
                for (index in 0 until items.length()) {
                    val item = items.getJSONObject(index)
                    check(item.optBoolean("isSharedText") || stagedPath(item)?.isFile == true)
                }
                files = items
                break
            } catch (_: Exception) {
                // Cache eviction or an interrupted write must not strand later shares.
                manifest.delete()
                items?.let { batch ->
                    for (index in 0 until batch.length()) {
                        runCatching { stagedPath(batch.getJSONObject(index))?.delete() }
                    }
                }
                recordError("A shared attachment is no longer available. Please share it again.")
            }
        }
        return JSObject().apply {
            put("files", files)
            if (errorFile.isFile) {
                put("error", errorFile.readText())
                errorFile.delete()
            }
        }
    }

    fun getPendingShares(invoke: Invoke) = worker.execute {
        try { invoke.resolve(readPendingShares()) }
        catch (_: Exception) { invoke.reject("Unable to read pending shares") }
    }

    internal fun acknowledge(tokens: Set<String>) {
        for (manifest in manifests()) {
            val items = try { JSONArray(manifest.readText()) } catch (_: Exception) {
                manifest.delete()
                continue
            }
            val retained = JSONArray()
            val removed = mutableListOf<JSONObject>()
            for (index in 0 until items.length()) {
                val item = items.getJSONObject(index)
                if (item.getString("token") in tokens) removed.add(item)
                else retained.put(item)
            }
            if (removed.isEmpty()) continue
            // Acknowledge the manifest before unlinking bytes: failed persistence
            // keeps a retryable, intact batch instead of leaving missing attachments.
            if (retained.length() == 0) check(manifest.delete())
            else {
                val temporary = File(inbox, "${manifest.name}.tmp")
                temporary.writeText(retained.toString())
                check(temporary.renameTo(manifest))
            }
            removed.forEach { stagedPath(it)?.delete() }
        }
    }

    fun clearShares(invoke: Invoke, done: () -> Unit) {
        val tokens = invoke.parseArgs(TokensArgs::class.java).tokens.toSet()
        worker.execute {
            try {
                acknowledge(tokens)
                invoke.resolve()
                done()
            } catch (_: Exception) { invoke.reject("Unable to clear shared files") }
        }
    }

    fun close() = worker.shutdown()

    fun stageClipboardImage(invoke: Invoke) {
        // Clipboard access happens only on an explicit paste, while focused.
        val uri = try {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.uri
        } catch (_: SecurityException) {
            invoke.reject("Unable to read clipboard image")
            return
        }
        if (uri == null || uri.scheme != "content") {
            invoke.resolve(JSObject())
            return
        }
        worker.execute {
            try {
                if (activity.contentResolver.getType(uri)?.startsWith("image/") != true) {
                    invoke.resolve(JSObject())
                    return@execute
                }
                cleanup()
                invoke.resolve(JSObject(stage(uri, pasteboard, "paste-stage-").toString()))
            } catch (_: Exception) { invoke.reject("Unable to read clipboard image") }
        }
    }
}
