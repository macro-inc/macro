package com.macro.preprocess.utils;

import com.macro.preprocess.nlp.collection.tuple.DoubleIntPair;
import com.macro.preprocess.nlp.collection.tuple.Pair;
import com.macro.preprocess.nlp.common.util.CharTokenizer;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

public class DSUtils {
    private DSUtils() {
    }

    public static Set<String> createStringHashSet(InputStream in) {
        return createStringHashSet(in, true, false);
    }

    public static Set<String> createStringHashSet(InputStream in, boolean trim, boolean decap) {
        BufferedReader reader = new BufferedReader(new InputStreamReader(in));
        Set<String> set = new HashSet();

        String line;
        try {
            while((line = reader.readLine()) != null) {
                if (trim) {
                    line = line.trim();
                    if (line.isEmpty()) {
                        continue;
                    }
                }

                if (decap) {
                    line = StringUtils.toLowerCase(line);
                }

                set.add(line);
            }
        } catch (IOException var7) {
            var7.printStackTrace();
        }

        return set;
    }

    public static Map<String, String> createStringHashMap(InputStream in, CharTokenizer tokenizer) {
        return createStringHashMap(in, tokenizer, true);
    }

    public static Map<String, String> createStringHashMap(InputStream in, CharTokenizer tokenizer, boolean trim) {
        BufferedReader reader = new BufferedReader(new InputStreamReader(in));
        Map<String, String> map = new HashMap();

        String line;
        try {
            while((line = reader.readLine()) != null) {
                if (trim) {
                    line = line.trim();
                    if (line.isEmpty()) {
                        continue;
                    }
                }

                String[] t = tokenizer.tokenize(line);
                map.put(t[0], t[1]);
            }
        } catch (IOException var8) {
            var8.printStackTrace();
        }

        return map;
    }

    public static <T extends Comparable<? extends T>> void sortReverseOrder(List<T> list) {
        Collections.sort(list, Collections.reverseOrder());
    }

    public static <T extends Comparable<? extends T>> void sortReverseOrder(T[] array) {
        Arrays.sort(array, Collections.reverseOrder());
    }

    public static <T> boolean hasIntersection(Collection<T> col1, Collection<T> col2) {
        if (col2.size() < col1.size()) {
            Collection<T> tmp = col1;
            col1 = col2;
            col2 = tmp;
        }

        Iterator var4 = col1.iterator();

        Object item;
        do {
            if (!var4.hasNext()) {
                return false;
            }

            item = var4.next();
        } while(!col2.contains(item));

        return true;
    }

    public static Set<String> getFieldSet(Class<?> cs) {
        Set<String> set = new HashSet();

        try {
            Field[] var2 = cs.getFields();
            int var3 = var2.length;

            for(int var4 = 0; var4 < var3; ++var4) {
                Field f = var2[var4];
                set.add(f.get(cs).toString());
            }
        } catch (IllegalArgumentException var6) {
            var6.printStackTrace();
        } catch (IllegalAccessException var7) {
            var7.printStackTrace();
        }

        return set;
    }

    public static <T> T get(List<T> list, int index) {
        return isRange(list, index) ? list.get(index) : null;
    }

    public static <T> T get(T[] array, int index) {
        return isRange(array, index) ? array[index] : null;
    }

    public static <T> T getLast(List<T> list) {
        return list.isEmpty() ? null : list.get(list.size() - 1);
    }

    public static <T> boolean isRange(List<T> list, int index) {
        return 0 <= index && index < list.size();
    }

    public static <T> boolean isRange(T[] array, int index) {
        return 0 <= index && index < array.length;
    }

    public static int[] range(int beginIndex, int endIndex, int gap) {
        double d = MathUtils.divide(endIndex - beginIndex, gap);
        if (d < 0.0) {
            return new int[0];
        } else {
            int[] array = new int[MathUtils.ceil(d)];
            int i;
            int j;
            if (beginIndex < endIndex) {
                i = beginIndex;

                for(j = 0; i < endIndex; ++j) {
                    array[j] = i;
                    i += gap;
                }
            } else {
                i = beginIndex;

                for(j = 0; i > endIndex; ++j) {
                    array[j] = i;
                    i += gap;
                }
            }

            return array;
        }
    }

    public static int[] range(int size) {
        return range(0, size, 1);
    }

    public static void swap(int[] array, int index0, int index1) {
        int tmp = array[index0];
        array[index0] = array[index1];
        array[index1] = tmp;
    }

    public static <T> void swap(List<T> list, int index0, int index1) {
        T tmp = list.get(index0);
        list.set(index0, list.get(index1));
        list.set(index1, tmp);
    }

    public static void shuffle(int[] array, Random rand) {
        shuffle(array, rand, array.length);
    }

    public static <T> void shuffle(List<T> list, Random rand) {
        shuffle(list, rand, list.size());
    }

    public static void shuffle(int[] array, Random rand, int lastIndex) {
        int size = lastIndex - 1;

        for(int i = 0; i < size; ++i) {
            int j = rand.nextInt(size - i) + i + 1;
            swap(array, i, j);
        }

    }

    public static <T> void shuffle(List<T> list, Random rand, int lastIndex) {
        int size = lastIndex - 1;

        for(int i = 0; i < size; ++i) {
            int j = rand.nextInt(size - i) + i + 1;
            swap(list, i, j);
        }

    }

    public static void addAll(List<String> list, String[] array) {
        String[] var2 = array;
        int var3 = array.length;

        for(int var4 = 0; var4 < var3; ++var4) {
            String item = var2[var4];
            list.add(item);
        }

    }

    public static <T> void removeLast(List<T> list) {
        if (!list.isEmpty()) {
            list.remove(list.size() - 1);
        }

    }

    public static int max(int[] array) {
        int size = array.length;
        int m = array[0];

        for(int i = 1; i < size; ++i) {
            m = Math.max(m, array[i]);
        }

        return m;
    }

    public static float max(float[] array) {
        int size = array.length;
        float m = array[0];

        for(int i = 1; i < size; ++i) {
            m = Math.max(m, array[i]);
        }

        return m;
    }

    public static double max(double[] array) {
        int size = array.length;
        double m = array[0];

        for(int i = 1; i < size; ++i) {
            m = Math.max(m, array[i]);
        }

        return m;
    }

    public static float min(float[] array) {
        int size = array.length;
        float m = array[0];

        for(int i = 1; i < size; ++i) {
            m = Math.min(m, array[i]);
        }

        return m;
    }

    public static double min(double[] array) {
        int size = array.length;
        double m = array[0];

        for(int i = 1; i < size; ++i) {
            m = Math.min(m, array[i]);
        }

        return m;
    }

    public static int maxIndex(double[] array) {
        int size = array.length;
        int maxIndex = 0;
        double maxValue = array[maxIndex];

        for(int i = 1; i < size; ++i) {
            if (maxValue < array[i]) {
                maxIndex = i;
                maxValue = array[i];
            }
        }

        return maxIndex;
    }

    public static int maxIndex(double[] array, int[] indices) {
        int size = indices.length;
        int maxIndex = indices[0];
        double maxValue = array[maxIndex];

        for(int j = 1; j < size; ++j) {
            int i = indices[j];
            if (maxValue < array[i]) {
                maxIndex = i;
                maxValue = array[i];
            }
        }

        return maxIndex;
    }

    public static <T> List<?>[] createEmptyListArray(int size) {
        List<?>[] array = new ArrayList[size];

        for(int i = 0; i < size; ++i) {
            array[i] = new ArrayList();
        }

        return array;
    }

    public static <T> PriorityQueue<?>[] createEmptyPriorityQueueArray(int size, boolean ascending) {
        PriorityQueue<?>[] queue = new PriorityQueue[size];

        for(int i = 0; i < size; ++i) {
            queue[i] = ascending ? new PriorityQueue() : new PriorityQueue(Collections.reverseOrder());
        }

        return queue;
    }

    public static <T> List<T> toList(T... items) {
        return (List)Arrays.stream(items).collect(Collectors.toList());
    }

    public static <T> Set<T> toHashSet(T... items) {
        return (Set)Arrays.stream(items).collect(Collectors.toSet());
    }

    public static <T> Set<T> merge(List<Set<T>> sets) {
        Set<T> merge = new HashSet();
        Iterator var2 = sets.iterator();

        while(var2.hasNext()) {
            Set<T> set = (Set)var2.next();
            merge.addAll(set);
        }

        return merge;
    }

    public static String[] toArray(Collection<String> col) {
        if (col == null) {
            return null;
        } else {
            String[] array = new String[col.size()];
            col.toArray(array);
            return array;
        }
    }

    public static <T> List<T> removeAll(Collection<T> source, Collection<T> remove) {
        List<T> list = new ArrayList(source);
        list.removeAll(remove);
        return list;
    }

    public static <T> boolean isSubset(Collection<T> s1, Collection<T> s2) {
        Iterator var2 = s2.iterator();

        Object t;
        do {
            if (!var2.hasNext()) {
                return true;
            }

            t = var2.next();
        } while(s1.contains(t));

        return false;
    }

    public static Pair<DoubleIntPair, DoubleIntPair> top2(double[] array) {
        int size = array.length;
        DoubleIntPair fst;
        DoubleIntPair snd;
        if (array[0] < array[1]) {
            fst = toDoubleIntPair(array, 1);
            snd = toDoubleIntPair(array, 0);
        } else {
            fst = toDoubleIntPair(array, 0);
            snd = toDoubleIntPair(array, 1);
        }

        for(int i = 2; i < size; ++i) {
            if (fst.d < array[i]) {
                snd.set(fst.d, fst.i);
                fst.set(array[i], i);
            } else if (snd.d < array[i]) {
                snd.set(array[i], i);
            }
        }

        return new Pair(fst, snd);
    }

    public static Pair<DoubleIntPair, DoubleIntPair> top2(double[] array, int[] include) {
        int size = include.length;
        DoubleIntPair fst;
        DoubleIntPair snd;
        if (array[include[0]] < array[include[1]]) {
            fst = toDoubleIntPair(array, include[1]);
            snd = toDoubleIntPair(array, include[0]);
        } else {
            fst = toDoubleIntPair(array, include[0]);
            snd = toDoubleIntPair(array, include[1]);
        }

        for(int j = 2; j < size; ++j) {
            int i = include[j];
            if (fst.d < array[i]) {
                snd.set(fst.d, fst.i);
                fst.set(array[i], i);
            } else if (snd.d < array[i]) {
                snd.set(array[i], i);
            }
        }

        return new Pair(fst, snd);
    }

    public static DoubleIntPair toDoubleIntPair(double[] array, int index) {
        return new DoubleIntPair(array[index], index);
    }

    public static Set<String> getBagOfWords(String s, Pattern splitter) {
        Set<String> set = new HashSet();
        String[] var3 = splitter.split(s);
        int var4 = var3.length;

        for(int var5 = 0; var5 < var4; ++var5) {
            String t = var3[var5];
            t = t.trim();
            if (!t.isEmpty()) {
                set.add(t);
            }
        }

        return set;
    }

    public static Set<String> getBagOfWords(InputStream in, Pattern splitter) {
        BufferedReader reader = IOUtils.createBufferedReader(in);
        Set<String> set = new HashSet();

        String line;
        try {
            while((line = reader.readLine()) != null) {
                set.addAll(getBagOfWords(line, splitter));
            }
        } catch (IOException var6) {
            var6.printStackTrace();
        }

        return set;
    }

    public static Set<String> getBagOfWords(String[] document, int ngram, String delim) {
        Set<String> set = new HashSet();
        int len = document.length;

        for(int n = 0; n <= ngram; ++n) {
            for(int i = 0; i < len - n; ++i) {
                set.add(Joiner.join(document, delim, i, i + n + 1));
            }
        }

        return set;
    }

    public static float[] toFloatArray(double[] array) {
        float[] f = new float[array.length];

        for(int i = 0; i < array.length; ++i) {
            f[i] = (float)array[i];
        }

        return f;
    }

    public static <T> Set<T> createSet(T... array) {
        Set<T> set = new HashSet();
        Object[] var2 = array;
        int var3 = array.length;

        for(int var4 = 0; var4 < var3; ++var4) {
            T item = (T) var2[var4];
            set.add(item);
        }

        return set;
    }

    public static void normalize01(float[] array) {
        float min = min(array);
        float div = max(array) - min;

        for(int i = 0; i < array.length; ++i) {
            array[i] = (array[i] - min) / div;
        }

    }
}
