package com.macro.preprocess.nlp.component.template.util;

import com.macro.preprocess.nlp.collection.tuple.ObjectIntIntTriple;
import it.unimi.dsi.fastutil.ints.Int2ObjectMap;
import it.unimi.dsi.fastutil.ints.Int2ObjectOpenHashMap;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.function.Function;

public enum BILOU {
    B,
    I,
    L,
    U,
    O;

    private BILOU() {
    }

    public static BILOU toBILOU(String tag) {
        return valueOf(tag.substring(0, 1));
    }

    public static String toBILOUTag(BILOU bilou, String tag) {
        return bilou + "-" + tag;
    }

    public static String toTag(String bilouTag) {
        return bilouTag.substring(2);
    }

    public static String changeChunkType(BILOU newBILOU, String tag) {
        return toBILOUTag(newBILOU, toTag(tag));
    }

    public static <N> Int2ObjectMap<ObjectIntIntTriple<String>> collectEntityMap(N[] nodes, Function<N, String> f, int beginIndex, int endIndex) {
        List<ObjectIntIntTriple<String>> list = collectEntityList(nodes, f, beginIndex, endIndex);
        Int2ObjectMap<ObjectIntIntTriple<String>> map = new Int2ObjectOpenHashMap();
        int size = nodes.length;
        Iterator var8 = list.iterator();

        while(var8.hasNext()) {
            ObjectIntIntTriple<String> t = (ObjectIntIntTriple)var8.next();
            int key = t.i1 * size + t.i2;
            map.put(key, t);
        }

        return map;
    }

    public static <N> List<ObjectIntIntTriple<String>> collectEntityList(N[] nodes, Function<N, String> f, int beginIndex, int endIndex) {
        List<ObjectIntIntTriple<String>> list = new ArrayList();
        int beginChunk = -1;

        for(int i = beginIndex; i < endIndex; ++i) {
            String tag = (String)f.apply(nodes[i]);
            if (tag != null) {
                switch (toBILOU(tag)) {
                    case U:
                        putNamedEntity(list, tag, i, i);
                        beginChunk = -1;
                        break;
                    case B:
                        beginChunk = i;
                        break;
                    case L:
                        if (beginIndex <= beginChunk && beginChunk < i) {
                            putNamedEntity(list, tag, beginChunk, i);
                        }

                        beginChunk = -1;
                        break;
                    case O:
                        beginChunk = -1;
                    case I:
                }
            }
        }

        return list;
    }

    private static void putNamedEntity(List<ObjectIntIntTriple<String>> list, String tag, int beginIndex, int endIndex) {
        list.add(new ObjectIntIntTriple(toTag(tag), beginIndex, endIndex));
    }
}
