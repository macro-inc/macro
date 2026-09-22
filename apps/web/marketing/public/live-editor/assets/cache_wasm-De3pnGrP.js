/* @ts-self-types="./cache_wasm.d.ts" */

export class CacheEngine {
    static __wrap(ptr) {
        const obj = Object.create(CacheEngine.prototype);
        obj.__wbg_ptr = ptr;
        CacheEngineFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CacheEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_cacheengine_free(ptr, 0);
    }
    /**
     * Returns the opaque identity bound to this cache, or `null` when no
     * identity-bearing response has been stored yet.
     * @returns {Promise<any>}
     */
    boundIdentity() {
        const ret = wasm.cacheengine_boundIdentity(this.__wbg_ptr);
        return ret;
    }
    /**
     * Claims the oldest runnable queued mutation.
     * @param {string} owner
     * @param {number} now_ms
     * @param {number} lease_expires_at_ms
     * @returns {Promise<any>}
     */
    claimNextMutation(owner, now_ms, lease_expires_at_ms) {
        const ptr0 = passStringToWasm0(owner, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_claimNextMutation(this.__wbg_ptr, ptr0, len0, now_ms, lease_expires_at_ms);
        return ret;
    }
    /**
     * Drops all cached state, including the durable mutation queue.
     * @returns {Promise<any>}
     */
    clear() {
        const ret = wasm.cacheengine_clear(this.__wbg_ptr);
        return ret;
    }
    /**
     * Consumes the engine, closes Turso and all OPFS handles, then preserves a
     * healthy database or resets a latched-unhealthy database before releasing
     * the exclusive owner lock. Every later instance method rejects.
     * @returns {Promise<any>}
     */
    close() {
        const ret = wasm.cacheengine_close(this.__wbg_ptr);
        return ret;
    }
    /**
     * Atomically replaces a claimed optimistic layer with the real network
     * response and removes it from the durable queue.
     * @param {string} transaction_id
     * @param {string} lease_owner
     * @param {string} lease_generation
     * @param {string} query
     * @param {string | null | undefined} operation_name
     * @param {any} variables
     * @param {any} data
     * @returns {Promise<any>}
     */
    commitOptimisticWrite(transaction_id, lease_owner, lease_generation, query, operation_name, variables, data) {
        const ptr0 = passStringToWasm0(transaction_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(lease_owner, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(lease_generation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        var ptr4 = isLikeNone(operation_name) ? 0 : passStringToWasm0(operation_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len4 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_commitOptimisticWrite(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, variables, data);
        return ret;
    }
    /**
     * Retains a retryable mutation and releases its queue lease.
     * @param {string} transaction_id
     * @param {string} lease_owner
     * @param {string} lease_generation
     * @param {number} next_attempt_at_ms
     * @param {string} error
     * @returns {Promise<any>}
     */
    deferOptimisticWrite(transaction_id, lease_owner, lease_generation, next_attempt_at_ms, error) {
        const ptr0 = passStringToWasm0(transaction_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(lease_owner, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(lease_generation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(error, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_deferOptimisticWrite(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, next_attempt_at_ms, ptr3, len3);
        return ret;
    }
    /**
     * Deletes stale records from memory and Turso after a server-side
     * mutation and resolves to affected local operation ids.
     * @param {string[]} keys
     * @returns {Promise<any>}
     */
    deleteKeys(keys) {
        const ptr0 = passArrayJsValueToWasm0(keys, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_deleteKeys(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Durably queues a mutation and its optimistic response, then attempts
     * to claim the strict queue head before resolving. Claim failures are
     * returned as a nested diagnostic outcome because enqueue succeeded.
     * @param {string | null | undefined} origin_op_id
     * @param {string} query
     * @param {string | null | undefined} operation_name
     * @param {any} variables
     * @param {any} data
     * @param {any} link_patches
     * @param {any} revalidations
     * @param {number} created_at_ms
     * @param {string} lease_owner
     * @param {number} now_ms
     * @param {number} lease_expires_at_ms
     * @returns {Promise<any>}
     */
    enqueueOptimisticMutation(origin_op_id, query, operation_name, variables, data, link_patches, revalidations, created_at_ms, lease_owner, now_ms, lease_expires_at_ms) {
        var ptr0 = isLikeNone(origin_op_id) ? 0 : passStringToWasm0(origin_op_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(operation_name) ? 0 : passStringToWasm0(operation_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(lease_owner, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_enqueueOptimisticMutation(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, variables, data, link_patches, revalidations, created_at_ms, ptr3, len3, now_ms, lease_expires_at_ms);
        return ret;
    }
    /**
     * Evaluates one exact `soup-flat-v1` GraphQL filter request.
     * @param {any} request
     * @returns {Promise<any>}
     */
    entityFilter(request) {
        const ret = wasm.cacheengine_entityFilter(this.__wbg_ptr, request);
        return ret;
    }
    /**
     * Reacts to a cache reset performed by another engine instance sharing
     * the same storage (cross-tab broadcast). Drops local in-memory state
     * and resolves to every local operation id (all must re-execute).
     * @returns {Promise<any>}
     */
    externalReset() {
        const ret = wasm.cacheengine_externalReset(this.__wbg_ptr);
        return ret;
    }
    /**
     * Normalizes and stores a query response while returning only fields not
     * marked `@cacheOnly` in the GraphQL document.
     * @param {string} query
     * @param {string | null | undefined} operation_name
     * @param {any} variables
     * @param {any} data
     * @param {string | null} [identity]
     * @returns {Promise<any>}
     */
    hydrateQuery(query, operation_name, variables, data, identity) {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(operation_name) ? 0 : passStringToWasm0(operation_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(identity) ? 0 : passStringToWasm0(identity, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_hydrateQuery(this.__wbg_ptr, ptr0, len0, ptr1, len1, variables, data, ptr2, len2);
        return ret;
    }
    /**
     * Enumerates and materializes cached variants of one generated query field.
     * @param {string} query
     * @param {string | null | undefined} operation_name
     * @param {any} path
     * @param {any} variable_filters
     * @returns {Promise<any>}
     */
    inspectQuery(query, operation_name, path, variable_filters) {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(operation_name) ? 0 : passStringToWasm0(operation_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_inspectQuery(this.__wbg_ptr, ptr0, len0, ptr1, len1, path, variable_filters);
        return ret;
    }
    /**
     * Recovers cached query variables without materializing each variant.
     * @param {string} query
     * @param {string | null | undefined} operation_name
     * @param {any} path
     * @returns {Promise<any>}
     */
    inspectQueryVariants(query, operation_name, path) {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(operation_name) ? 0 : passStringToWasm0(operation_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_inspectQueryVariants(this.__wbg_ptr, ptr0, len0, ptr1, len1, path);
        return ret;
    }
    /**
     * Evicts externally-changed records from the hot tier (cross-tab
     * broadcasts, push invalidation). Resolves to the affected local
     * operation ids.
     * @param {string[]} keys
     * @returns {Promise<any>}
     */
    invalidateKeys(keys) {
        const ptr0 = passArrayJsValueToWasm0(keys, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_invalidateKeys(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Physically resets and recreates this instance's OPFS database while
     * retaining the exclusive owner lock. The instance remains usable after
     * the fresh engine has been installed.
     * @returns {Promise<any>}
     */
    physicalReset() {
        const ret = wasm.cacheengine_physicalReset(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns payload-free durable mutation queue diagnostics.
     * @returns {Promise<any>}
     */
    queueDiagnostics() {
        const ret = wasm.cacheengine_queueDiagnostics(this.__wbg_ptr);
        return ret;
    }
    /**
     * Attempts a cache read. Resolves to `{kind:"hit",data}` or
     * `{kind:"miss"}`. When `opId` is given, the operation is registered
     * as active for dependency-driven re-execution.
     * @param {string | null | undefined} op_id
     * @param {string} query
     * @param {string | null | undefined} operation_name
     * @param {any} variables
     * @param {any} entity_resolvers
     * @returns {Promise<any>}
     */
    readQuery(op_id, query, operation_name, variables, entity_resolvers) {
        var ptr0 = isLikeNone(op_id) ? 0 : passStringToWasm0(op_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(operation_name) ? 0 : passStringToWasm0(operation_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_readQuery(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, variables, entity_resolvers);
        return ret;
    }
    /**
     * Projects explicit normalized entity keys through a named GraphQL
     * fragment without scanning storage.
     * @param {string} document
     * @param {string} fragment_name
     * @param {any} keys
     * @returns {Promise<any>}
     */
    readRecordsByKeys(document, fragment_name, keys) {
        const ptr0 = passStringToWasm0(document, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(fragment_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_readRecordsByKeys(this.__wbg_ptr, ptr0, len0, ptr1, len1, keys);
        return ret;
    }
    /**
     * Reloads optimistic layers after another engine changes the durable
     * queue and returns locally affected operations.
     * @returns {Promise<any>}
     */
    refreshOptimisticQueue() {
        const ret = wasm.cacheengine_refreshOptimisticQueue(this.__wbg_ptr);
        return ret;
    }
    /**
     * Permanently fails a claimed mutation and removes its optimistic
     * contribution.
     * @param {string} transaction_id
     * @param {string} lease_owner
     * @param {string} lease_generation
     * @returns {Promise<any>}
     */
    rollbackOptimisticWrite(transaction_id, lease_owner, lease_generation) {
        const ptr0 = passStringToWasm0(transaction_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(lease_owner, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(lease_generation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_rollbackOptimisticWrite(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        return ret;
    }
    /**
     * Searches the compact materialized projection. Empty queries use the
     * indexed recent path; text queries rank the compact catalog without
     * scanning normalized record blobs.
     * @param {any} request
     * @returns {Promise<any>}
     */
    search(request) {
        const ret = wasm.cacheengine_search(this.__wbg_ptr, request);
        return ret;
    }
    /**
     * Unregisters an operation (urql teardown).
     * @param {string} op_id
     * @returns {Promise<any>}
     */
    teardownOperation(op_id) {
        const ptr0 = passStringToWasm0(op_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_teardownOperation(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Normalizes and stores a network response. Resolves to
     * `{changed: string[], affectedOps: string[], reset: boolean}` —
     * `affectedOps` are the registered operation ids (excluding
     * `originOpId`) whose data changed. `identity` is an opaque session tag
     * (extracted by the exchange from the response); a tag mismatching the
     * cache's bound identity wipes and rebinds atomically with this write.
     * @param {any} context
     * @param {string} query
     * @param {string | null | undefined} operation_name
     * @param {any} variables
     * @param {any} data
     * @param {string | null} [identity]
     * @returns {Promise<any>}
     */
    writeQuery(context, query, operation_name, variables, data, identity) {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(operation_name) ? 0 : passStringToWasm0(operation_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(identity) ? 0 : passStringToWasm0(identity, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.cacheengine_writeQuery(this.__wbg_ptr, context, ptr0, len0, ptr1, len1, variables, data, ptr2, len2);
        return ret;
    }
}
if (Symbol.dispose) CacheEngine.prototype[Symbol.dispose] = CacheEngine.prototype.free;

/**
 * Recovery-wipes and recreates the cache database for `scope` while holding
 * the same exclusive OPFS owner lock used by [`openCache`](open_cache).
 * @param {string} scope
 * @returns {Promise<void>}
 */
export function destroyCache(scope) {
    const ptr0 = passStringToWasm0(scope, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.destroyCache(ptr0, len0);
    return ret;
}

/**
 * Opens (or creates) the cache for `scope` after acquiring its exclusive OPFS
 * owner lock. The physical identity is derived from `scope` alone; disposable
 * incomplete or incompatible files are reset and reopened before returning.
 * @param {string} scope
 * @param {number | null} [hot_capacity]
 * @returns {Promise<CacheEngine>}
 */
export function openCache(scope, hot_capacity) {
    const ptr0 = passStringToWasm0(scope, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.openCache(ptr0, len0, isLikeNone(hot_capacity) ? Number.MAX_SAFE_INTEGER : (hot_capacity) >>> 0);
    return ret;
}

/**
 * Acquires the canonical owner once, recovery-wipes before any Turso open,
 * then opens a fresh cache while continuously retaining that same owner lock.
 * @param {string} scope
 * @param {number | null} [hot_capacity]
 * @returns {Promise<CacheEngine>}
 */
export function openCacheForRecovery(scope, hot_capacity) {
    const ptr0 = passStringToWasm0(scope, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.openCacheForRecovery(ptr0, len0, isLikeNone(hot_capacity) ? Number.MAX_SAFE_INTEGER : (hot_capacity) >>> 0);
    return ret;
}

/**
 * Additive recovery-open API returning the engine and coarse wipe outcome.
 * @param {string} scope
 * @param {number | null} [hot_capacity]
 * @returns {Promise<any>}
 */
export function openCacheForRecoveryWithOutcome(scope, hot_capacity) {
    const ptr0 = passStringToWasm0(scope, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.openCacheForRecoveryWithOutcome(ptr0, len0, isLikeNone(hot_capacity) ? Number.MAX_SAFE_INTEGER : (hot_capacity) >>> 0);
    return ret;
}

/**
 * Additive open API returning the engine and payload-free recovery outcome.
 * @param {string} scope
 * @param {number | null} [hot_capacity]
 * @returns {Promise<any>}
 */
export function openCacheWithOutcome(scope, hot_capacity) {
    const ptr0 = passStringToWasm0(scope, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.openCacheWithOutcome(ptr0, len0, isLikeNone(hot_capacity) ? Number.MAX_SAFE_INTEGER : (hot_capacity) >>> 0);
    return ret;
}

/**
 * Schema hash baked into this build (build diagnostics).
 * @returns {string}
 */
export function schemaHash() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.schemaHash();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_92b29b0548f8b746: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Number_9a4e0ecb0fa16705: function(arg0) {
            const ret = Number(arg0);
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_d968e41184ae354f: function(arg0, arg1) {
            const v = arg1;
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_fa956cfa2d1bd751: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_c25d447a39f5578f: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_aca499c5de7ff5e5: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_bigint_2f76dc55065b4273: function(arg0) {
            const ret = typeof(arg0) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_1ff95bcc5517c252: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_ea9085d691f535d3: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_a27215656b807791: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_ea5e6cc2e4141dfe: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_e659fcf7b0e32763: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_db4c3b15f63fc170: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_394265ed1e1b84ee: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_b0ca35b86a603356: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_fffb441def202758: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_abort_8bae0f33e7833997: function(arg0) {
            arg0.abort();
        },
        __wbg_cacheengine_new: function(arg0) {
            const ret = CacheEngine.__wrap(arg0);
            return ret;
        },
        __wbg_call_44b7209e1e252e6a: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            const ret = arg0.call(arg1, arg2, arg3, arg4);
            return ret;
        }, arguments); },
        __wbg_call_8a2dd23819f8a60a: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_call_a6e5c5dce5018821: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_e3b662382210db98: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_createSyncAccessHandle_0caafebe31e4f2d9: function(arg0) {
            const ret = arg0.createSyncAccessHandle();
            return ret;
        },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_done_89b2b13e91a60321: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_entries_015dc610cd81ede0: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_flush_a4bd8d4e05ad23f6: function() { return handleError(function (arg0) {
            arg0.flush();
        }, arguments); },
        __wbg_getDirectory_389283588dfb8117: function(arg0) {
            const ret = arg0.getDirectory();
            return ret;
        },
        __wbg_getFileHandle_72de55ab3ca9ad57: function(arg0, arg1, arg2, arg3) {
            const ret = arg0.getFileHandle(getStringFromWasm0(arg1, arg2), arg3);
            return ret;
        },
        __wbg_getFileHandle_96903ab38e634823: function(arg0, arg1, arg2) {
            const ret = arg0.getFileHandle(getStringFromWasm0(arg1, arg2));
            return ret;
        },
        __wbg_getRandomValues_3f44b700395062e5: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_getRandomValues_ef12552bf5acd2fe: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getSize_29187e13478442fb: function() { return handleError(function (arg0) {
            const ret = arg0.getSize();
            return ret;
        }, arguments); },
        __wbg_getTime_d6f070c088c9b5ed: function(arg0) {
            const ret = arg0.getTime();
            return ret;
        },
        __wbg_getTimezoneOffset_dc9862c79e5a81a3: function(arg0) {
            const ret = arg0.getTimezoneOffset();
            return ret;
        },
        __wbg_get_507a50627bffa49b: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_78f252d074a84d0b: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_c7eb1f358a7654df: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_unchecked_6e0ad6d2a41b06f6: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_with_ref_key_6412cf3094599694: function(arg0, arg1) {
            const ret = arg0[arg1];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_4480b9e0068a8adb: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_DedicatedWorkerGlobalScope_773ccaf956f5a0f0: function(arg0) {
            let result;
            try {
                result = arg0 instanceof DedicatedWorkerGlobalScope;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_DomException_952faa8037702c00: function(arg0) {
            let result;
            try {
                result = arg0 instanceof DOMException;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_FileSystemDirectoryHandle_c9ab7c5cdb7a7c30: function(arg0) {
            let result;
            try {
                result = arg0 instanceof FileSystemDirectoryHandle;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_FileSystemFileHandle_68e80b30532d5f04: function(arg0) {
            let result;
            try {
                result = arg0 instanceof FileSystemFileHandle;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_FileSystemSyncAccessHandle_db0b7504516129c1: function(arg0) {
            let result;
            try {
                result = arg0 instanceof FileSystemSyncAccessHandle;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Map_e5b5e3db98422fcc: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Map;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Promise_4cb210c0b8f8c959: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Promise;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_309b927aaf7a3fc7: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_0677c962b281d01a: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isSafeInteger_04f36e4056f1b851: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_iterator_6f722e4a93058b71: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_1f0964f4a5e2c6d8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_370319915dc99107: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_name_9d2bcd24d4433cef: function(arg0, arg1) {
            const ret = arg1.name;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_navigator_51379c10a84aeec9: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_new_0_3da9e97f24fc69be: function() {
            const ret = new Date();
            return ret;
        },
        __wbg_new_32b398fb48b6d94a: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_4339b2a2675a03e3: function() { return handleError(function () {
            const ret = new AbortController();
            return ret;
        }, arguments); },
        __wbg_new_7796ffc7ed656783: function() {
            const ret = new Map();
            return ret;
        },
        __wbg_new_aec3e25493d729fe: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h7fdfdd5d2ebddee7(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_b667d279fd5aa943: function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_cc984128914cfc6f: function(arg0) {
            const ret = new Date(arg0);
            return ret;
        },
        __wbg_new_cd45aabdf6073e84: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_da52cf8fe3429cb2: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_typed_1824d93f294193e5: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h7fdfdd5d2ebddee7(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_length_e6785c33c8e4cce8: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_next_6dbf2c0ac8cde20f: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_71f2aa1cb3d1e37e: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_now_0cce8c6798af1870: function() { return handleError(function () {
            const ret = Date.now();
            return ret;
        }, arguments); },
        __wbg_now_86c0d4ba3fa605b8: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_now_9a697ad25482a470: function() {
            const ret = performance.now();
            return ret;
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_4770620bbe4688a0: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_queueMicrotask_0ab5b2d2393e99b9: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_6a09b7bc46549209: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_read_27d98fb08886b1fc: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.read(getArrayU8FromWasm0(arg1, arg2), arg3);
            return ret;
        }, arguments); },
        __wbg_removeEntry_6716e344f14ec77f: function(arg0, arg1, arg2, arg3) {
            const ret = arg0.removeEntry(getStringFromWasm0(arg1, arg2), arg3);
            return ret;
        },
        __wbg_removeEntry_e38219fa4a98cfb3: function(arg0, arg1, arg2) {
            const ret = arg0.removeEntry(getStringFromWasm0(arg1, arg2));
            return ret;
        },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_resolve_2191a4dfe481c25b: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_set_575dd786d51585f8: function(arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_8535240470bf2500: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_8a16b38e4805b298: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_at_674f6538cd77adef: function(arg0, arg1) {
            arg0.at = arg1;
        },
        __wbg_set_create_a807a6e9ac628698: function(arg0, arg1) {
            arg0.create = arg1 !== 0;
        },
        __wbg_set_recursive_a4f915c7492b89e8: function(arg0, arg1) {
            arg0.recursive = arg1 !== 0;
        },
        __wbg_signal_dad7cb35193abd31: function(arg0) {
            const ret = arg0.signal;
            return ret;
        },
        __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_146583524fe1469b: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_f2829a2234d7819e: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_storage_3c893ad40b9e831e: function(arg0) {
            const ret = arg0.storage;
            return ret;
        },
        __wbg_subarray_3ed232c8a6baee09: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_then_16d107c451e9905d: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_6ec10ae38b3e92f7: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_truncate_98a6032d23095328: function() { return handleError(function (arg0, arg1) {
            arg0.truncate(arg1);
        }, arguments); },
        __wbg_value_a5d5488a9589444a: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbg_write_e557b5312ec23477: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.write(getArrayU8FromWasm0(arg1, arg2), arg3);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 196, ret: Externref, inner_ret: Some(Externref) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h674d0ff591eafe23);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 196, ret: NamedExternref("Promise<any>"), inner_ret: Some(NamedExternref("Promise<any>")) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h674d0ff591eafe23_1);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 3825, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hc5a5770e2ccfdcf9);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000005: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000006: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000007: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000008: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./cache_wasm_bg.js": import0,
    };
}

function wasm_bindgen__convert__closures_____invoke__h674d0ff591eafe23(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h674d0ff591eafe23(arg0, arg1, arg2);
    return ret;
}

function wasm_bindgen__convert__closures_____invoke__h674d0ff591eafe23_1(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h674d0ff591eafe23_1(arg0, arg1, arg2);
    return ret;
}

function wasm_bindgen__convert__closures_____invoke__hc5a5770e2ccfdcf9(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__hc5a5770e2ccfdcf9(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h7fdfdd5d2ebddee7(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h7fdfdd5d2ebddee7(arg0, arg1, arg2, arg3);
}

const CacheEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_cacheengine_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('cache_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
