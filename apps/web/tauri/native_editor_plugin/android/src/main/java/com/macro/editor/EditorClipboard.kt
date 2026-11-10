package com.macro.editor

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.PersistableBundle
import com.macro.documentsession.*

/** Standard Android HTML/plain pair with app-owned structured copy metadata. */
internal class EditorClipboard(context: Context) {
    private val clipboard = context.getSystemService(ClipboardManager::class.java)

    fun read(): FfiClipboardPayload? {
        val clip = clipboard.primaryClip ?: return null
        if (clip.itemCount == 0) return null
        val item = clip.getItemAt(0)
        val entries = mutableListOf<FfiClipboardEntry>()
        val extras = clip.description.extras
        val copiedPlain = extras?.getString("com.macro.editor.plain")
        if (copiedPlain != null && copiedPlain == item.text?.toString()) {
            for (mime in listOf("application/x-lexical-editor", "text/markdown")) {
                extras?.getString("com.macro.editor.$mime")?.let { entries += FfiClipboardEntry(mime, it) }
            }
        }
        item.htmlText?.let { entries += FfiClipboardEntry("text/html", it) }
        if (entries.none { it.mime == "text/markdown" } && clip.description.hasMimeType("text/markdown")) {
            item.text?.let { entries += FfiClipboardEntry("text/markdown", it.toString()) }
        }
        item.text?.let { entries += FfiClipboardEntry("text/plain", it.toString()) }
        val files = (0 until clip.itemCount).any { clip.getItemAt(it).uri != null }
        return FfiClipboardPayload(entries, files, null, FfiPasteIntent(false))
    }

    fun write(entries: List<FfiClipboardEntry>): Boolean {
        val plain = entries.firstOrNull { it.mime == "text/plain" }?.text ?: return false
        val html = entries.firstOrNull { it.mime == "text/html" }?.text
        val data = if (html == null) ClipData.newPlainText("", plain)
            else ClipData.newHtmlText("", plain, html)
        val extras = PersistableBundle()
        extras.putString("com.macro.editor.plain", plain)
        for (entry in entries) {
            if (entry.mime == "application/x-lexical-editor" || entry.mime == "text/markdown") {
                extras.putString("com.macro.editor.${entry.mime}", entry.text)
            }
        }
        data.description.extras = extras
        clipboard.setPrimaryClip(data)
        return true
    }
}
