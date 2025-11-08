package com.macro.preprocess.nlp.component.template.feature;

import com.macro.preprocess.nlp.learning.*;
import com.macro.preprocess.utils.CharUtils;
import com.macro.preprocess.nlp.common.util.FastUtils;
import com.macro.preprocess.nlp.common.util.XMLUtils;
import com.macro.preprocess.utils.Joiner;
import com.macro.preprocess.utils.Splitter;
import com.macro.preprocess.nlp.node.AbstractNLPNode;
import com.macro.preprocess.nlp.component.template.state.NLPState;
import com.macro.preprocess.nlp.component.template.train.HyperParameter;
import it.unimi.dsi.fastutil.objects.Object2IntMap;
import it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap;
import it.unimi.dsi.fastutil.objects.ObjectIterator;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.Serializable;
import java.util.*;

public class FeatureTemplate<N extends AbstractNLPNode<N>, S extends NLPState<N>> implements Serializable {
    private static final long serialVersionUID = -6755594173767815098L;
    protected List<FeatureItem[]> feature_list = new ArrayList();
    protected List<FeatureItem> feature_set = new ArrayList();
    protected List<FeatureItem> word_embeddings = new ArrayList();
    protected Object2IntMap<String> feature_count = new Object2IntOpenHashMap();
    protected FeatureMap feature_map = new FeatureMap();
    protected int cutoff;

    public FeatureTemplate(Element eFeatures, HyperParameter hp) {
        this.setCutoff(hp.getFeature_cutoff());
        this.init(eFeatures);
    }

    public List<FeatureItem[]> getFeatureList() {
        return this.feature_list;
    }

    public List<FeatureItem> getSetFeatureList() {
        return this.feature_set;
    }

    public List<FeatureItem> getEmbeddingFeatureList() {
        return this.word_embeddings;
    }

    protected void init(Element eFeatures) {
        if (eFeatures != null) {
            NodeList nodes = eFeatures.getElementsByTagName("feature");

            for(int i = 0; i < nodes.getLength(); ++i) {
                Element element = (Element)nodes.item(i);
                this.initFeatureItems(element);
            }

        }
    }

    protected void initFeatureItems(Element element) {
        FeatureItem[] items = this.createFeatureItems(element);
        if (XMLUtils.getBooleanAttribute(element, "set")) {
            this.addSet(items[0]);
        } else if (items[0].field == Field.word_embedding) {
            this.addWordEmbedding(items[0]);
        } else {
            this.add(items);
        }

    }

    protected FeatureItem[] createFeatureItems(Element element) {
        List<String> list = new ArrayList();
        int i = 0;

        while(true) {
            String s = element.getAttribute("f" + i);
            if (s.isEmpty()) {
                FeatureItem[] items = new FeatureItem[list.size()];

                for(int j = 0; j < items.length; ++j) {
                    items[j] = this.createFeatureItem((String)list.get(j));
                }

                return items;
            }

            list.add(s);
            ++i;
        }
    }

    private FeatureItem createFeatureItem(String s) {
        String[] t = Splitter.splitColons(s);
        s = t[0];
        Source source = Source.valueOf(s.substring(0, 1));
        int endIdx = s.indexOf(95);
        if (endIdx < 0) {
            endIdx = s.length();
        }

        int window = endIdx == 1 ? 0 : Integer.parseInt(s.substring(1, endIdx));
        Relation relation = endIdx != s.length() ? Relation.valueOf(s.substring(endIdx + 1)) : null;
        Field field = Field.valueOf(t[1]);
        Object attribute = t.length > 2 ? this.createAttribute(field, t[2]) : null;
        return new FeatureItem(source, relation, window, field, attribute);
    }

    protected Object createAttribute(Field field, String attribute) {
        switch (field) {
            case prefix:
            case suffix:
                return Integer.parseInt(attribute);
            case feats:
                return attribute;
            case valency:
                return Direction.valueOf(attribute);
            case dependent_set:
                return Field.valueOf(attribute);
            default:
                return null;
        }
    }

    public void add(FeatureItem... items) {
        this.feature_list.add(items);
    }

    public void addSet(FeatureItem items) {
        this.feature_set.add(items);
    }

    public void addWordEmbedding(FeatureItem item) {
        this.word_embeddings.add(item);
    }

    public int getSparseFeatureSize() {
        return this.feature_map.size();
    }

    public int getTemplateSize() {
        return this.feature_list.size() + this.feature_set.size() + this.word_embeddings.size();
    }

    public int getCutoff() {
        return this.cutoff;
    }

    public void setCutoff(int cutoff) {
        this.cutoff = cutoff;
    }

    public void clearFeatureCount() {
        this.feature_count.clear();
    }

    public void initFeatureCount() {
        this.feature_count = new Object2IntOpenHashMap();
    }

    public FeatureVector createFeatureVector(S state, boolean isTrain) {
        return new FeatureVector(this.createSparseVector(state, isTrain), this.createDenseVector(state));
    }

    public SparseVector createSparseVector(S state, boolean isTrain) {
        SparseVector x = new SparseVector();
        int type = 0;

        int i;
        for(i = 0; i < this.feature_set.size(); ++type) {
            Collection<String> t = this.getFeatures(state, (FeatureItem)this.feature_set.get(i));
            if (t != null) {
                Iterator var8 = t.iterator();

                while(var8.hasNext()) {
                    String s = (String)var8.next();
                    this.add(x, type, s, 1.0F, isTrain);
                }
            }

            ++i;
        }

        for(i = 0; i < this.feature_list.size(); ++type) {
            String f = this.getFeature(state, (FeatureItem[])this.feature_list.get(i));
            this.add(x, type, f, 1.0F, isTrain);
            ++i;
        }

        return x;
    }

    protected void add(SparseVector x, int type, String value, float weight, boolean isTrain) {
        if (value != null) {
            int index;
            if (isTrain) {
                index = FastUtils.increment(this.feature_count, type + value) > this.cutoff ? this.feature_map.add(type, value) : -1;
            } else {
                index = this.feature_map.index(type, value);
            }

            if (index > 0) {
                x.add(index, weight);
            }
        }

    }

    protected String getFeature(S state, FeatureItem... items) {
        if (items.length == 1) {
            return this.getFeature(state, items[0]);
        } else {
            StringJoiner join = new StringJoiner("_");
            FeatureItem[] var5 = items;
            int var6 = items.length;

            for(int var7 = 0; var7 < var6; ++var7) {
                FeatureItem item = var5[var7];
                String f = this.getFeature(state, item);
                if (f == null) {
                    return null;
                }

                join.add(f);
            }

            return join.toString();
        }
    }

    protected String getFeature(S state, FeatureItem item) {
        N node = state.getNode(item);
        return node == null ? null : this.getFeature(state, item, node);
    }

    protected String getFeature(S state, FeatureItem item, N node) {
        String f = node.getValue(item.field);
        if (f != null) {
            return f;
        } else {
            switch (item.field) {
                case prefix:
                    return this.getPrefix(node, (Integer)item.attribute);
                case suffix:
                    return this.getSuffix(node, (Integer)item.attribute);
                case feats:
                    return node.getFeat((String)item.attribute);
                case valency:
                    return node.getValency((Direction)item.attribute);
                default:
                    return null;
            }
        }
    }

    protected String getPrefix(N node, int n) {
        String s = node.getWordFormSimplifiedLowercase();
        return n < s.length() ? s.substring(0, n) : null;
    }

    protected String getSuffix(N node, int n) {
        String s = node.getWordFormSimplifiedLowercase();
        return n < s.length() ? s.substring(s.length() - n) : null;
    }

    protected Collection<String> getFeatures(S state, FeatureItem item) {
        N node = state.getNode(item);
        return node == null ? null : this.getFeatures(state, item, node);
    }

    protected Collection<String> getFeatures(S state, FeatureItem item, N node) {
        switch (item.field) {
            case dependent_set:
                return node.getDependentValueSet((Field)item.attribute);
            case positional:
                return this.getPositionFeatures(state, node);
            case orthographic:
                return this.getOrthographicFeatures(state, node, true);
            case orthographic_lowercase:
                return this.getOrthographicFeatures(state, node, false);
            case ambiguity_classes:
                return node.getAmbiguityClasseList();
            case named_entity_gazetteers:
                return node.getNamedEntityGazetteerSet();
            case word_clusters:
                return node.getWordClusters();
            default:
                return null;
        }
    }

    protected List<String> getPositionFeatures(S state, N node) {
        List<String> values = new ArrayList();
        if (state.isFirst(node)) {
            values.add("0");
        } else if (state.isLast(node)) {
            values.add("1");
        }

        return values.isEmpty() ? null : values;
    }

    protected List<String> getOrthographicFeatures(S state, N node, boolean caseSensitive) {
        List<String> list = new ArrayList();
        if ("#hlink#".equals(node.getWordFormSimplified())) {
            list.add("0");
        } else {
            char[] cs = node.getWordFormSimplified().toCharArray();
            this.getOrthographicFeauturesAux(list, cs, state.isFirst(node), caseSensitive);
        }

        return list.isEmpty() ? null : list;
    }

    protected void getOrthographicFeauturesAux(List<String> list, char[] cs, boolean isFirst, boolean caseSensitive) {
        boolean hasDigit = false;
        boolean hasPeriod = false;
        boolean hasHyphen = false;
        boolean hasPunct = false;
        boolean fstUpper = false;
        boolean allDigit = true;
        boolean allPunct = true;
        boolean allUpper = true;
        boolean allLower = true;
        boolean noLower = true;
        boolean allDigitOrPunct = true;
        int countUpper = 0;
        int size = cs.length;

        for(int i = 0; i < size; ++i) {
            char c = cs[i];
            boolean upper = CharUtils.isUpperCase(c);
            boolean lower = CharUtils.isLowerCase(c);
            boolean digit = CharUtils.isDigit(c);
            boolean punct = CharUtils.isPunctuation(c);
            if (upper) {
                if (i == 0) {
                    fstUpper = true;
                } else {
                    ++countUpper;
                }
            } else {
                allUpper = false;
            }

            if (lower) {
                noLower = false;
            } else {
                allLower = false;
            }

            if (digit) {
                hasDigit = true;
            } else {
                allDigit = false;
            }

            if (punct) {
                hasPunct = true;
                if (c == '.') {
                    hasPeriod = true;
                }

                if (c == '-') {
                    hasHyphen = true;
                }
            } else {
                allPunct = false;
            }

            if (!digit && !punct) {
                allDigitOrPunct = false;
            }
        }

        if (allUpper) {
            if (caseSensitive) {
                list.add("1");
            }
        } else if (allLower) {
            if (caseSensitive) {
                list.add("2");
            }
        } else if (allDigit) {
            list.add("3");
        } else if (allPunct) {
            list.add("4");
        } else if (allDigitOrPunct) {
            list.add("5");
        } else if (noLower && caseSensitive) {
            list.add("10");
        }

        if (caseSensitive && !allUpper) {
            if (fstUpper && !isFirst) {
                list.add("11");
            }

            if (countUpper == 1) {
                list.add("12");
            } else if (countUpper > 1) {
                list.add("13");
            }
        }

        if (!allDigit && hasDigit) {
            list.add("6");
        }

        if (hasPeriod) {
            list.add("7");
        }

        if (hasHyphen) {
            list.add("8");
        }

        if (!allPunct && !hasPeriod && !hasHyphen && hasPunct) {
            list.add("9");
        }

    }

    protected Set<StringPrediction> toSet(Object2IntMap<String> map) {
        Set<StringPrediction> set = new HashSet();
        ObjectIterator var3 = map.object2IntEntrySet().iterator();

        while(var3.hasNext()) {
            Object2IntMap.Entry<String> e = (Object2IntMap.Entry)var3.next();
            set.add(new StringPrediction((String)e.getKey(), (float)e.getIntValue()));
        }

        return set;
    }

    public float[] createDenseVector(S state) {
        return this.getEmbeddings(state);
    }

    public float[] getEmbeddings(S state) {
        if (this.word_embeddings != null && !this.word_embeddings.isEmpty()) {
            float[] v = null;
            int i = -1;
            Iterator var6 = this.word_embeddings.iterator();

            while(var6.hasNext()) {
                FeatureItem item = (FeatureItem)var6.next();
                N node = state.getNode(item);
                ++i;
                if (node != null && node.hasWordEmbedding()) {
                    float[] w = node.getWordEmbedding();
                    if (v == null) {
                        v = new float[w.length * this.word_embeddings.size()];
                    }

                    System.arraycopy(w, 0, v, w.length * i, w.length);
                }
            }

            return v;
        } else {
            return null;
        }
    }

    public String toString() {
        StringBuilder build = new StringBuilder();
        Iterator var2 = this.feature_list.iterator();

        while(var2.hasNext()) {
            FeatureItem[] t = (FeatureItem[])var2.next();
            build.append("[" + Joiner.join(t, "],[") + "]\n");
        }

        var2 = this.feature_set.iterator();

        while(var2.hasNext()) {
            FeatureItem t = (FeatureItem)var2.next();
            build.append(t + "\n");
        }

        if (this.word_embeddings != null) {
            build.append(Joiner.join(this.word_embeddings, ",") + "\n");
        }

        return build.toString();
    }

    public int reduce(WeightVector weights, float threshold) {
        int L = weights.getLabelSize();
        int F = weights.getSparseWeightVector().getFeatureSize();
        MajorVector oldSparse = weights.getSparseWeightVector();
        int[] indexMap = new int[F];
        int count = 1;

        int j;
        int k;
        for(int i = 1; i < F; ++i) {
            k = i * L;
            float max = oldSparse.get(k);
            float min = oldSparse.get(k);

            for(j = 1; j < L; ++j) {
                max = Math.max(max, oldSparse.get(k + j));
                min = Math.min(min, oldSparse.get(k + j));
            }

            if (Math.abs(max - min) >= threshold) {
                indexMap[i] = count++;
            }
        }

        MajorVector newSparse = new ColumnMajorVector();
        newSparse.expand(L, count);

        for(j = 0; j < L; ++j) {
            newSparse.set(j, oldSparse.get(j));
        }

        Iterator var19 = this.feature_map.getIndexMaps().iterator();

        label50:
        while(var19.hasNext()) {
            Object2IntMap<String> map = (Object2IntMap)var19.next();
            ObjectIterator<Object2IntMap.Entry<String>> it = map.object2IntEntrySet().iterator();

            while(true) {
                while(true) {
                    if (!it.hasNext()) {
                        continue label50;
                    }

                    Object2IntMap.Entry<String> e = (Object2IntMap.Entry)it.next();
                    int oldIndex = e.getIntValue();
                    int newIndex = oldIndex < indexMap.length ? indexMap[oldIndex] : -1;
                    if (newIndex > 0) {
                        e.setValue(newIndex);
                        k = oldIndex * L;
                        int l = newIndex * L;

                        for(j = 0; j < L; ++j) {
                            newSparse.set(l + j, oldSparse.get(k + j));
                        }
                    } else {
                        it.remove();
                    }
                }
            }
        }

        weights.setSparseWeightVector(newSparse);
        this.feature_map.setSize(count);
        return count;
    }
}