package com.macro.editor

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.JsonNodeFactory
import com.macro.documentsession.*
import com.macro.editor.bridge.mapper
import java.math.BigInteger

/** JSON at the Tauri boundary uses the FFI's owned value tree, never a WASM codec. */
internal object BridgeJson {
    fun parse(json: String): FfiValue = fromNode(requireNotNull(mapper.readTree(json)))

    fun root(json: String): SerializedNode {
        val state = requireNotNull(mapper.readTree(json))
        val root = requireNotNull(state.get("root")) { "Expected a serialized editor state root" }
        val value = fromNode(root)
        require(value is FfiValue.Map) { "Expected an object root" }
        return value.entries
    }

    fun stringify(value: FfiValue): String = toNode(value).toString()

    fun state(root: SerializedNode): String = JsonNodeFactory.instance.objectNode().apply {
        set<JsonNode>("root", toNode(FfiValue.Map(root)))
    }.toString()

    private fun fromNode(node: JsonNode): FfiValue = when {
        node.isNull -> FfiValue.Null
        node.isBoolean -> FfiValue.Bool(node.booleanValue())
        node.isIntegralNumber && node.canConvertToLong() -> FfiValue.Int(node.longValue())
        node.isNumber -> FfiValue.NumberLiteral(node.toString())
        node.isTextual -> FfiValue.Text(node.textValue())
        node.isArray -> FfiValue.Array(node.map(::fromNode))
        node.isObject -> FfiValue.Map(node.fields().asSequence().map {
            FfiValueEntry(it.key, fromNode(it.value))
        }.toList())
        else -> throw IllegalArgumentException("Expected JSON data")
    }

    private fun toNode(value: FfiValue): JsonNode = when (value) {
        FfiValue.Null -> JsonNodeFactory.instance.nullNode()
        is FfiValue.Bool -> JsonNodeFactory.instance.booleanNode(value.value)
        is FfiValue.Int -> JsonNodeFactory.instance.numberNode(value.value)
        is FfiValue.Unsigned -> JsonNodeFactory.instance.numberNode(BigInteger(value.value.toString()))
        is FfiValue.Number -> {
            require(value.value.isFinite())
            JsonNodeFactory.instance.numberNode(value.value)
        }
        is FfiValue.NumberLiteral -> requireNotNull(mapper.readTree(value.value)).also { require(it.isNumber) }
        is FfiValue.Text -> JsonNodeFactory.instance.textNode(value.value)
        is FfiValue.Array -> JsonNodeFactory.instance.arrayNode().apply {
            value.values.forEach { add(toNode(it)) }
        }
        is FfiValue.Map -> JsonNodeFactory.instance.objectNode().apply {
            value.entries.forEach { set<JsonNode>(it.key, toNode(it.value)) }
        }
        is FfiValue.Bytes, is FfiValue.ContainerId, is FfiValue.NewContainer ->
            throw IllegalArgumentException("Native container values are not JSON data")
    }
}
