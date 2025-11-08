package com.macro.preprocess.nlp.common.util;

import it.unimi.dsi.fastutil.floats.FloatArrayList;
import it.unimi.dsi.fastutil.objects.Object2IntMap;

public class FastUtils {
    public FastUtils() {
    }

    public static <K> int increment(Object2IntMap<K> map, K key) {
        return (Integer)map.merge(key, 1, (oldCount, newCount) -> {
            return oldCount + newCount;
        });
    }

    public static <K> int increment(Object2IntMap<K> map, K key, int count) {
        return (Integer)map.merge(key, count, (oldCount, newCount) -> {
            return oldCount + newCount;
        });
    }

    public static void add(FloatArrayList list, int index, float inc) {
        list.set(index, list.getFloat(index) + inc);
    }
}
