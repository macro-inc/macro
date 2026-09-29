package com.macro.mobile

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

@InvokeArg class BeginExportArgs {
    var name: String = "download"
    var mimeType: String = "application/octet-stream"
}
@InvokeArg class ExportTokenArgs { lateinit var token: String }
@InvokeArg class AppendExportArgs {
    lateinit var token: String
    lateinit var data: String
}
@InvokeArg class FinishExportArgs {
    lateinit var token: String
    var action: String = "save"
}

/** Chunked JS Blob transfer keeps large exports out of a single IPC message. */
class MobileExports(private val activity: Activity) {
    private data class Export(val file: File, val mimeType: String)
    private val worker = Executors.newSingleThreadExecutor()
    private val active = mutableMapOf<String, Export>()
    private val directory = File(activity.cacheDir, "android-exports")
    private var saving: Export? = null

    fun begin(invoke: Invoke) {
        val args = invoke.parseArgs(BeginExportArgs::class.java)
        worker.execute {
            try {
                directory.mkdirs()
                val cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000
                directory.listFiles()?.filter { it.isDirectory && it.lastModified() < cutoff }
                    ?.forEach { it.deleteRecursively() }
                val token = UUID.randomUUID().toString()
                val folder = File(directory, token).apply { mkdirs() }
                val file = File(folder, MobileFiles.safeName(args.name))
                file.createNewFile()
                active[token] = Export(file, args.mimeType.ifBlank { "application/octet-stream" })
                invoke.resolve(JSObject().apply { put("token", token) })
            } catch (_: Exception) { invoke.reject("Unable to create export") }
        }
    }

    fun append(invoke: Invoke) {
        val args = invoke.parseArgs(AppendExportArgs::class.java)
        worker.execute {
            try {
                val export = active[args.token] ?: error("Unknown export")
                require(args.data.length <= 400_000) { "Export chunk is too large" }
                val bytes = Base64.decode(args.data, Base64.DEFAULT)
                require(export.file.length() + bytes.size <= MobileFiles.MAX_FILE_BYTES)
                export.file.appendBytes(bytes)
                invoke.resolve()
            } catch (_: Exception) { invoke.reject("Unable to write export") }
        }
    }

    fun discard(invoke: Invoke) {
        val token = invoke.parseArgs(ExportTokenArgs::class.java).token
        worker.execute {
            active.remove(token)?.file?.parentFile?.deleteRecursively()
            invoke.resolve()
        }
    }

    fun finish(invoke: Invoke, launchSave: (Intent) -> Unit) {
        val args = invoke.parseArgs(FinishExportArgs::class.java)
        worker.execute {
            val export = active.remove(args.token)
            if (export == null) { invoke.reject("Unknown export"); return@execute }
            activity.runOnUiThread {
                try {
                    if (args.action == "save") {
                        check(saving == null) { "A save dialog is already open" }
                        saving = export
                        launchSave(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = export.mimeType
                            putExtra(Intent.EXTRA_TITLE, export.file.name)
                        })
                    } else {
                        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", export.file)
                        val clip = ClipData.newUri(activity.contentResolver, export.file.name, uri)
                        if (args.action == "copy") {
                            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            clipboard.setPrimaryClip(clip)
                        } else {
                            require(args.action == "share" || args.action == "open")
                            val intent = Intent(if (args.action == "share") Intent.ACTION_SEND else Intent.ACTION_VIEW).apply {
                                if (args.action == "share") {
                                    type = export.mimeType
                                    putExtra(Intent.EXTRA_STREAM, uri)
                                } else setDataAndType(uri, export.mimeType)
                                clipData = clip
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            activity.startActivity(Intent.createChooser(intent, null))
                        }
                        // Receivers may read asynchronously; retain until the 24-hour cleanup.
                        invoke.resolve(JSObject().apply { put("canceled", false) })
                    }
                } catch (_: Exception) {
                    if (saving == export) saving = null
                    export.file.parentFile?.deleteRecursively()
                    invoke.reject("No application could complete this file action")
                }
            }
        }
    }

    fun close() = worker.shutdown()

    fun saved(invoke: Invoke, result: ActivityResult) {
        val export = saving
        saving = null
        if (export == null) { invoke.reject("Export is no longer available"); return }
        worker.execute {
            try {
                val uri = result.data?.data
                val canceled = result.resultCode != Activity.RESULT_OK || uri == null
                if (!canceled) {
                    val output = activity.contentResolver.openOutputStream(uri!!, "wt")
                        ?: error("Destination is unavailable")
                    output.use { destination -> export.file.inputStream().use { it.copyTo(destination) } }
                }
                invoke.resolve(JSObject().apply { put("canceled", canceled) })
            } catch (_: Exception) { invoke.reject("Unable to save file") }
            finally { export.file.parentFile?.deleteRecursively() }
        }
    }
}
