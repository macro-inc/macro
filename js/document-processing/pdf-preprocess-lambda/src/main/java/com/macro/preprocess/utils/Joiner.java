package com.macro.preprocess.utils;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

public class Joiner {
    public Joiner() {
    }

    public static <T> String join(Collection<T> collection, String delim) {
        return join(collection, delim, (p) -> {
            return p.toString();
        });
    }

    public static <T> String join(Collection<T> collection, String delim, Function<T, String> f) {
        return (String)collection.stream().map(f).collect(Collectors.joining(delim));
    }

    public static <T> String join(T[] array, String delim, int beginIndex, int endIndex, Function<T, String> f) {
        if (endIndex <= beginIndex) {
            return "";
        } else {
            StringJoiner build = new StringJoiner(delim);

            for(int i = beginIndex; i < endIndex; ++i) {
                build.add((CharSequence)f.apply(array[i]));
            }

            return build.toString();
        }
    }

    public static <T> String join(T[] array, String delim, int beginIndex, int endIndex) {
        return join(array, delim, beginIndex, endIndex, (n) -> {
            return n.toString();
        });
    }

    public static <T> String join(T[] array, String delim, int beginIndex) {
        return join(array, delim, beginIndex, array.length, (n) -> {
            return n.toString();
        });
    }

    public static <T> String join(T[] array, String delim) {
        return join((Object[])array, delim, 0, array.length);
    }

    public static <T> String join(List<T> list, String delim, int beginIndex, int endIndex, Function<T, String> f) {
        if (endIndex - beginIndex == 0) {
            return "";
        } else {
            StringJoiner build = new StringJoiner(delim);

            for(int i = beginIndex; i < endIndex; ++i) {
                build.add((CharSequence)f.apply(list.get(i)));
            }

            return build.toString();
        }
    }

    public static <T> String join(List<T> list, String delim, int beginIndex, int endIndex) {
        return join(list, delim, beginIndex, endIndex, Object::toString);
    }

    public static <T extends Comparable<T>> String join(List<T> list, String delim, boolean sort) {
        if (sort) {
            Collections.sort(list);
        }

        return join((List)list, delim, 0, list.size());
    }
}
