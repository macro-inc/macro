package com.macro.preprocess.nlp.node;

import com.macro.preprocess.nlp.common.collection.arc.AbstractArc;
import com.macro.preprocess.nlp.common.collection.list.SortedArrayList;
import com.macro.preprocess.nlp.collection.tuple.Pair;
import com.macro.preprocess.nlp.constants.StringConst;
import com.macro.preprocess.utils.DSUtils;
import com.macro.preprocess.utils.Joiner;
import com.macro.preprocess.utils.StringUtils;
import com.macro.preprocess.nlp.component.dep.DEPArc;
import com.macro.preprocess.nlp.component.template.feature.Direction;
import com.macro.preprocess.nlp.component.template.feature.Field;
import com.macro.preprocess.nlp.reader.TSVReader;
import it.unimi.dsi.fastutil.ints.IntOpenHashSet;
import it.unimi.dsi.fastutil.ints.IntSet;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.StringJoiner;
import java.util.TreeSet;
import java.util.function.BiPredicate;
import java.util.regex.Pattern;

public abstract class AbstractNLPNode<N extends AbstractNLPNode<N>> implements Serializable, Comparable<N> {
    private static final long serialVersionUID = -6890831718184647451L;

    protected int id;
    protected String word_form;
    protected String lemma;
    protected String pos_tag;
    protected String nament_tag;
    protected FeatMap feat_map;
    protected String dependency_label;
    protected N dependency_head;
    protected List<DEPArc<N>> semantic_heads;
    protected List<DEPArc<N>> secondary_heads;
    protected int start_offset;
    protected int end_offset;
    public int dependent_id;
    protected String word_form_lowercase;
    protected String word_form_simplified;
    protected String word_form_undigitalized;
    protected String word_form_simplified_lowercase;
    protected SortedArrayList<N> dependent_list;
    protected Set<String> named_entity_gazetteers;
    protected List<String> ambiguity_classes;
    protected Set<String> word_clusters;
    protected float[] word_embedding;
    protected boolean stop_word;

    public abstract N self();

    public AbstractNLPNode() {
        this.toRoot();
    }

    public AbstractNLPNode(int id, String form) {
        this(id, form, (String)null);
    }

    public AbstractNLPNode(int id, String form, String posTag) {
        this(id, form, posTag, new FeatMap());
    }

    public AbstractNLPNode(int id, String form, String posTag, FeatMap feats) {
        this(id, form, (String)null, posTag, feats);
    }

    public AbstractNLPNode(int id, String form, String lemma, String posTag, FeatMap feats) {
        this(id, form, lemma, posTag, (String)null, feats);
    }

    public AbstractNLPNode(int id, String form, String lemma, String posTag, String namentTag, FeatMap feats) {
        this.set(id, form, lemma, posTag, namentTag, feats, null, (String)null);
    }

    public AbstractNLPNode(int id, String form, String lemma, String posTag, FeatMap feats, N dhead, String deprel) {
        this.set(id, form, lemma, posTag, (String)null, feats, dhead, deprel);
    }

    public AbstractNLPNode(int id, String form, String lemma, String posTag, String namentTag, FeatMap feats, N dhead, String deprel) {
        this.set(id, form, lemma, posTag, namentTag, feats, dhead, deprel);
    }

    public void set(int id, String form, String lemma, String posTag, String namentTag, FeatMap feats, N dhead, String deprel) {
        this.setID(id);
        this.setWordForm(form);
        this.setLemma(lemma);
        this.setPartOfSpeechTag(posTag);
        this.setNamedEntityTag(namentTag);
        this.setFeatMap(feats);
        this.setDependencyHead(dhead);
        this.setDependencyLabel(deprel);
        this.dependent_list = new SortedArrayList();
        this.semantic_heads = new ArrayList();
    }

    public N toRoot() {
        this.set(0, "@#r$%", "@#r$%", "@#r$%", "@#r$%", new FeatMap(), null, (String)null);
        return this.self();
    }

    public int getID() {
        return this.id;
    }

    public String getWordForm() {
        return this.word_form;
    }

    public String getWordFormLowercase() {
        return this.word_form_lowercase;
    }

    public String getWordFormSimplified() {
        return this.word_form_simplified;
    }

    public String getWordFormSimplifiedLowercase() {
        return this.word_form_simplified_lowercase;
    }

    public String getWordFormUndigitalized() {
        return this.word_form_undigitalized;
    }

    public String getWordShape() {
        return StringUtils.getShape(this.word_form_simplified, 2);
    }

    public String getWordShapeLowercase() {
        return StringUtils.getShape(this.word_form_simplified_lowercase, 2);
    }

    public String getLemma() {
        return this.lemma;
    }

    public String getPartOfSpeechTag() {
        return this.pos_tag;
    }

    public String getNamedEntityTag() {
        return this.nament_tag;
    }

    public FeatMap getFeatMap() {
        return this.feat_map;
    }

    public String getFeat(String key) {
        return (String)this.feat_map.get(key);
    }

    public String getValue(Field field) {
        switch (field) {
            case word_form:
                return this.getWordForm();
            case word_form_lowercase:
                return this.getWordFormLowercase();
            case word_form_simplified:
                return this.getWordFormSimplified();
            case word_form_undigitalized:
                return this.getWordFormUndigitalized();
            case word_form_simplified_lowercase:
                return this.getWordFormSimplifiedLowercase();
            case word_shape:
                return this.getWordShape();
            case word_shape_lowercase:
                return this.getWordShapeLowercase();
            case lemma:
                return this.getLemma();
            case part_of_speech_tag:
                return this.getPartOfSpeechTag();
            case named_entity_tag:
                return this.getNamedEntityTag();
            case dependency_label:
                return this.getDependencyLabel();
            case ambiguity_classes:
                return this.getAmbiguityClasses();
            case named_entity_gazetteers:
                return this.getNamedEntityGazetteers();
            default:
                return null;
        }
    }

    public Set<String> getWordClusters() {
        return this.word_clusters;
    }

    public float[] getWordEmbedding() {
        return this.word_embedding;
    }

    public String getAmbiguityClass(int index) {
        return this.ambiguity_classes != null && DSUtils.isRange(this.ambiguity_classes, index) ? (String)this.ambiguity_classes.get(index) : null;
    }

    public String getAmbiguityClasses() {
        return this.getCollectionValue(this.ambiguity_classes);
    }

    public List<String> getAmbiguityClasseList() {
        return this.ambiguity_classes;
    }

    public String getNamedEntityGazetteers() {
        return this.getCollectionValue(this.named_entity_gazetteers);
    }

    public Set<String> getNamedEntityGazetteerSet() {
        return this.named_entity_gazetteers;
    }

    protected String getCollectionValue(Collection<String> col) {
        return col != null && !col.isEmpty() ? Joiner.join(col, StringConst.UNDERSCORE) : null;
    }

    public int getStartOffset() {
        return this.start_offset;
    }

    public int getEndOffset() {
        return this.end_offset;
    }

    public void setID(int id) {
        this.id = id;
    }

    public void setWordForm(String form) {
        this.word_form = form;
        this.word_form_lowercase = StringUtils.toLowerCase(this.word_form);
        this.word_form_simplified = StringUtils.toSimplifiedForm(form);
        this.word_form_undigitalized = StringUtils.toUndigitalizedForm(form);
        this.word_form_simplified_lowercase = StringUtils.toLowerCase(this.word_form_simplified);
    }

    public void setLemma(String lemma) {
        this.lemma = lemma;
    }

    public void setPartOfSpeechTag(String tag) {
        this.pos_tag = tag;
    }

    public void setStartOffset(int offset) {
        this.start_offset = offset;
    }

    public void setEndOffset(int offset) {
        this.end_offset = offset;
    }

    public void setFeatMap(FeatMap map) {
        this.feat_map = map;
    }

    public String putFeat(String key, String value) {
        return (String)this.feat_map.put(key, value);
    }

    public String removeFeat(String key) {
        return (String)this.feat_map.remove(key);
    }

    public void setNamedEntityTag(String tag) {
        this.nament_tag = tag;
    }

    public void setAmbiguityClasses(List<String> classes) {
        this.ambiguity_classes = classes;
    }

    public void setWordClusters(Set<String> clusters) {
        this.word_clusters = clusters;
    }

    public void setWordEmbedding(float[] embedding) {
        this.word_embedding = embedding;
    }

    public void setNamedEntityGazetteers(Set<String> gazetteers) {
        this.named_entity_gazetteers = gazetteers;
    }

    public void addNamedEntityGazetteer(String gazetteer) {
        if (this.named_entity_gazetteers == null) {
            this.named_entity_gazetteers = new TreeSet();
        }

        this.named_entity_gazetteers.add(gazetteer);
    }

    public void setStopWord(boolean stopword) {
        this.stop_word = stopword;
    }

    public boolean isID(int id) {
        return this.id == id;
    }

    public boolean isWordForm(String form) {
        return form.equals(this.word_form);
    }

    public boolean isSimplifiedWordForm(String form) {
        return form.equals(this.word_form_simplified);
    }

    public boolean isLemma(String lemma) {
        return lemma.equals(this.lemma);
    }

    public boolean isPartOfSpeechTag(String tag) {
        return tag.equals(this.pos_tag);
    }

    public boolean isPartOfSpeechTag(Pattern pattern) {
        return pattern.matcher(this.pos_tag).find();
    }

    public boolean isNamedEntityTag(String tag) {
        return tag.equals(this.nament_tag);
    }

    public boolean isStopWord() {
        return this.stop_word;
    }

    public boolean hasWordClusters() {
        return this.word_clusters != null;
    }

    public boolean hasWordEmbedding() {
        return this.word_embedding != null;
    }

    public String getDependencyLabel() {
        return this.dependency_label;
    }

    public N getDependencyHead() {
        return this.dependency_head;
    }

    public N getDependencyGrandHead() {
        N head = this.getDependencyHead();
        return head == null ? null : head.getDependencyHead();
    }

    public N getGrandDependencyHead() {
        N head = this.getDependencyHead();
        return head == null ? null : head.getDependencyHead();
    }

    public N getLeftNearestDependent() {
        return this.getLeftNearestDependent(0);
    }

    public N getLeftNearestDependent(int order) {
        int index = this.dependent_list.getInsertIndex(this.self()) - order - 1;
        return index >= 0 ? this.getDependent(index) : null;
    }

    public N getRightNearestDependent() {
        return this.getRightNearestDependent(0);
    }

    public N getRightNearestDependent(int order) {
        int index = this.dependent_list.getInsertIndex(this.self()) + order;
        return index < this.getDependentSize() ? this.getDependent(index) : null;
    }

    public N getLeftMostDependent() {
        return this.getLeftMostDependent(0);
    }

    public N getLeftMostDependent(int order) {
        if (DSUtils.isRange(this.dependent_list, order)) {
            N dep = this.getDependent(order);
            if (dep.id < this.id) {
                return dep;
            }
        }

        return null;
    }

    public N getRightMostDependent() {
        return this.getRightMostDependent(0);
    }

    public N getRightMostDependent(int order) {
        order = this.getDependentSize() - 1 - order;
        if (DSUtils.isRange(this.dependent_list, order)) {
            N dep = this.getDependent(order);
            if (dep.id > this.id) {
                return dep;
            }
        }

        return null;
    }

    public N getLeftNearestSibling() {
        return this.getLeftNearestSibling(0);
    }

    public N getLeftNearestSibling(int order) {
        if (this.dependency_head != null) {
            order = this.dependent_id - order - 1;
            if (order >= 0) {
                return this.dependency_head.getDependent(order);
            }
        }

        return null;
    }

    public N getLeftNearestSibling(String label) {
        if (this.dependency_head != null) {
            for(int i = this.dependent_id - 1; i >= 0; --i) {
                N node = this.dependency_head.getDependent(i);
                if (node.isDependencyLabel(label)) {
                    return node;
                }
            }
        }

        return null;
    }

    public N getRightNearestSibling() {
        return this.getRightNearestSibling(0);
    }

    public N getRightNearestSibling(int order) {
        if (this.dependency_head != null) {
            order = this.dependent_id + order + 1;
            if (order < this.dependency_head.getDependentSize()) {
                return this.dependency_head.getDependent(order);
            }
        }

        return null;
    }

    public N getRightNearestSibling(String label) {
        if (this.dependency_head != null) {
            int size = this.dependency_head.getDependentSize();

            for(int i = this.dependent_id + 1; i < size; ++i) {
                N node = this.dependency_head.getDependent(i);
                if (node.isDependencyLabel(label)) {
                    return node;
                }
            }
        }

        return null;
    }

    public N getFirstDependent(String label, BiPredicate<N, String> predicate) {
        Iterator var3 = this.dependent_list.iterator();

        AbstractNLPNode node;
        do {
            if (!var3.hasNext()) {
                return null;
            }

            node = (AbstractNLPNode)var3.next();
        } while(!predicate.test((N) node, label));

        return (N) node;
    }

    public N getFirstDependentByLabel(Pattern pattern) {
        Iterator var2 = this.dependent_list.iterator();

        AbstractNLPNode node;
        do {
            if (!var2.hasNext()) {
                return null;
            }

            node = (AbstractNLPNode)var2.next();
        } while(!node.isDependencyLabel(pattern));

        return (N) node;
    }

    public List<N> getDependentList() {
        return this.dependent_list;
    }

    public List<N> getDependentListByLabel(String label) {
        List<N> list = new ArrayList();
        Iterator var3 = this.dependent_list.iterator();

        while(var3.hasNext()) {
            N node = (N) var3.next();
            if (node.isDependencyLabel(label)) {
                list.add(node);
            }
        }

        return list;
    }

    public List<N> getDependentListByLabel(Set<String> labels) {
        List<N> list = new ArrayList();
        Iterator var3 = this.dependent_list.iterator();

        while(var3.hasNext()) {
            N node = (N) var3.next();
            if (labels.contains(node.getDependencyLabel())) {
                list.add(node);
            }
        }

        return list;
    }

    public List<N> getDependentListByLabel(Pattern pattern) {
        List<N> list = new ArrayList();
        Iterator var3 = this.dependent_list.iterator();

        while(var3.hasNext()) {
            N node = (N)var3.next();
            if (node.isDependencyLabel(pattern)) {
                list.add(node);
            }
        }

        return list;
    }

    public List<N> getLeftDependentList() {
        List<N> list = new ArrayList();
        Iterator var2 = this.dependent_list.iterator();

        while(var2.hasNext()) {
            N node = (N)var2.next();
            if (node.id > this.id) {
                break;
            }

            list.add(node);
        }

        return list;
    }

    public List<N> getLeftDependentListByLabel(Pattern pattern) {
        List<N> list = new ArrayList();
        Iterator var3 = this.dependent_list.iterator();

        while(var3.hasNext()) {
            N node = (N)var3.next();
            if (node.id > this.id) {
                break;
            }

            if (node.isDependencyLabel(pattern)) {
                list.add(node);
            }
        }

        return list;
    }

    public List<N> getRightDependentList() {
        List<N> list = new ArrayList();
        Iterator var2 = this.dependent_list.iterator();

        while(var2.hasNext()) {
            N node = (N)var2.next();
            if (node.id >= this.id) {
                list.add(node);
            }
        }

        return list;
    }

    public List<N> getRightDependentListByLabel(Pattern pattern) {
        List<N> list = new ArrayList();
        Iterator var3 = this.dependent_list.iterator();

        while(var3.hasNext()) {
            N node = (N)var3.next();
            if (node.id >= this.id && node.isDependencyLabel(pattern)) {
                list.add(node);
            }
        }

        return list;
    }

    public List<N> getGrandDependentList() {
        List<N> list = new ArrayList();
        Iterator var2 = this.dependent_list.iterator();

        while(var2.hasNext()) {
            N node = (N)var2.next();
            list.addAll(node.getDependentList());
        }

        return list;
    }

    public List<N> getDescendantList(int height) {
        List<N> list = new ArrayList();
        if (height > 0) {
            this.getDescendantListAux(this.self(), list, height - 1);
        }

        return list;
    }

    private void getDescendantListAux(N node, List<N> list, int height) {
        list.addAll(node.getDependentList());
        if (height > 0) {
            Iterator var4 = node.getDependentList().iterator();

            while(var4.hasNext()) {
                N dep = (N)var4.next();
                this.getDescendantListAux(dep, list, height - 1);
            }
        }

    }

    public N getAnyDescendantByPartOfSpeechTag(String tag) {
        return this.getAnyDescendantByPartOfSpeechTagAux(this.self(), tag);
    }

    private N getAnyDescendantByPartOfSpeechTagAux(N node, String tag) {
        Iterator var3 = node.getDependentList().iterator();

        AbstractNLPNode dep;
        do {
            if (!var3.hasNext()) {
                return null;
            }

            dep = (N)var3.next();
            if (dep.isPartOfSpeechTag(tag)) {
                return (N) dep;
            }

            dep = this.getAnyDescendantByPartOfSpeechTagAux((N) dep, tag);
        } while(dep == null);

        return (N) dep;
    }

    public List<N> getSubNodeList() {
        List<N> list = new ArrayList();
        this.getSubNodeCollectionAux(list, this.self());
        Collections.sort(list);
        return list;
    }

    public Set<N> getSubNodeSet() {
        Set<N> set = new HashSet();
        this.getSubNodeCollectionAux(set, this.self());
        return set;
    }

    private void getSubNodeCollectionAux(Collection<N> col, N node) {
        col.add(node);
        Iterator var3 = node.getDependentList().iterator();

        while(var3.hasNext()) {
            N dep = (N)var3.next();
            this.getSubNodeCollectionAux(col, dep);
        }

    }

    public IntSet getSubNodeIDSet() {
        IntSet set = new IntOpenHashSet();
        this.getSubNodeIDSetAux(set, this.self());
        return set;
    }

    private void getSubNodeIDSetAux(IntSet set, N node) {
        set.add(node.id);
        Iterator var3 = node.getDependentList().iterator();

        while(var3.hasNext()) {
            N dep = (N)var3.next();
            this.getSubNodeIDSetAux(set, dep);
        }

    }

    public int[] getSubNodeIDSortedArray() {
        IntSet set = this.getSubNodeIDSet();
        int[] list = set.toIntArray();
        Arrays.sort(list);
        return list;
    }

    public N getDependent(int index) {
        return (N)this.dependent_list.get(index);
    }

    public int getDependentIndex(N node) {
        return this.dependent_list.indexOf(node);
    }

    public int getDependentSize() {
        return this.dependent_list.size();
    }

    public String getValency(Direction direction) {
        switch (direction) {
            case left:
                return this.getLeftValency();
            case right:
                return this.getRightValency();
            case all:
                return this.getLeftValency() + "-" + this.getRightValency();
            default:
                return null;
        }
    }

    public String getLeftValency() {
        StringBuilder build = new StringBuilder();
        if (this.getLeftMostDependent() != null) {
            build.append(StringConst.LESS_THAN);
            if (this.getLeftMostDependent(1) != null) {
                build.append(StringConst.LESS_THAN);
            }
        }

        return build.toString();
    }

    public String getRightValency() {
        StringBuilder build = new StringBuilder();
        if (this.getRightMostDependent() != null) {
            build.append(StringConst.GREATER_THAN);
            if (this.getRightMostDependent(1) != null) {
                build.append(StringConst.GREATER_THAN);
            }
        }

        return build.toString();
    }

    public Set<String> getDependentValueSet(Field field) {
        Set<String> s = new HashSet();
        Iterator var3 = this.getDependentList().iterator();

        while(var3.hasNext()) {
            N dep = (N)var3.next();
            s.add(dep.getValue(field));
        }

        return s;
    }

    public String getSubcategorization(Direction direction, Field field) {
        switch (direction) {
            case left:
                return this.getLeftSubcategorization(field);
            case right:
                return this.getRightSubcategorization(field);
            case all:
                String left = this.getLeftSubcategorization(field);
                if (left == null) {
                    return this.getRightSubcategorization(field);
                }

                String right = this.getRightSubcategorization(field);
                return right == null ? left : left + right;
            default:
                return null;
        }
    }

    public String getLeftSubcategorization(Field field) {
        StringBuilder build = new StringBuilder();
        int size = this.getDependentSize();

        for(int i = 0; i < size; ++i) {
            N node = this.getDependent(i);
            if (node.getID() > this.id) {
                break;
            }

            build.append(StringConst.LESS_THAN);
            build.append(node.getValue(field));
        }

        return build.length() > 0 ? build.toString() : null;
    }

    public String getRightSubcategorization(Field field) {
        StringBuilder build = new StringBuilder();
        int size = this.getDependentSize();

        for(int i = size - 1; i >= 0; --i) {
            N node = this.getDependent(i);
            if (node.getID() < this.id) {
                break;
            }

            build.append(StringConst.GREATER_THAN);
            build.append(node.getValue(field));
        }

        return build.length() > 0 ? build.toString() : null;
    }

    public String getPath(N node, Field field) {
        N lca = this.getLowestCommonAncestor(node);
        return lca != null ? this.getPath(node, lca, field) : null;
    }

    public String getPath(N node, N lca, Field field) {
        if (node == lca) {
            return this.getPathAux(lca, this.self(), field, "^", true);
        } else {
            return this == lca ? this.getPathAux(lca, node, field, "|", true) : this.getPathAux(lca, this.self(), field, "^", true) + this.getPathAux(lca, node, field, "|", false);
        }
    }

    private String getPathAux(N top, N bottom, Field field, String delim, boolean includeTop) {
        StringBuilder build = new StringBuilder();
        N node = bottom;
        int dist = 0;

        do {
            String s = node.getValue(field);
            if (s != null) {
                build.append(delim);
                build.append(s);
            } else {
                ++dist;
            }

            node = node.getDependencyHead();
        } while(node != top && node != null);

        if (field == Field.distance) {
            build.append(delim);
            build.append(dist);
        } else if (field != Field.dependency_label && includeTop) {
            build.append(delim);
            build.append(top.getValue(field));
        }

        return build.length() == 0 ? null : build.toString();
    }

    public Set<N> getAncestorSet() {
        Set<N> set = new HashSet();

        for(N node = this.getDependencyHead(); node != null; node = node.getDependencyHead()) {
            set.add(node);
        }

        return set;
    }

    public N getLowestCommonAncestor(N node) {
        Set<N> set = this.getAncestorSet();
        set.add(this.self());

        while(node != null) {
            if (set.contains(node)) {
                return node;
            }

            node = node.getDependencyHead();
        }

        return null;
    }

    public void setDependencyLabel(String label) {
        this.dependency_label = label;
    }

    public void setDependencyHead(N node) {
        if (this.hasDependencyHead()) {
            this.dependency_head.dependent_list.remove(this.self());
            this.dependency_head.resetDependentIDs();
        }

        if (node != null) {
            node.dependent_list.addItem(this.self());
            node.resetDependentIDs();
        }

        this.dependency_head = node;
    }

    public void setDependencyHead(N node, String label) {
        this.setDependencyHead(node);
        this.setDependencyLabel(label);
    }

    public void addDependent(N node) {
        node.setDependencyHead(this.self());
    }

    public void addDependent(N node, String label) {
        node.setDependencyHead(this.self(), label);
    }

    public DEPArc<N> clearDependencies() {
        DEPArc<N> arc = new DEPArc(this.dependency_head, this.dependency_label);
        this.dependency_head = null;
        this.dependency_label = null;
        this.dependent_list.clear();
        return arc;
    }

    protected void resetDependentIDs() {
        for(int i = 0; i < this.dependent_list.size(); ((AbstractNLPNode)this.dependent_list.get(i)).dependent_id = i++) {
        }

    }

    public boolean hasDependencyHead() {
        return this.dependency_head != null;
    }

    public boolean isDependencyLabel(String label) {
        return label.equals(this.dependency_label);
    }

    public boolean isDependencyLabelAny(String... labels) {
        String[] var2 = labels;
        int var3 = labels.length;

        for(int var4 = 0; var4 < var3; ++var4) {
            String label = var2[var4];
            if (this.isDependencyLabel(label)) {
                return true;
            }
        }

        return false;
    }

    public boolean isDependencyLabel(Pattern pattern) {
        return pattern.matcher(this.dependency_label).find();
    }

    public boolean isDependentOf(N node) {
        return this.dependency_head == node;
    }

    public boolean isDependentOf(N node, String label) {
        return this.isDependentOf(node) && this.isDependencyLabel(label);
    }

    public boolean containsDependent(N node) {
        return this.dependent_list.contains(node);
    }

    public boolean containsDependent(String label, BiPredicate<N, String> predicate) {
        return this.getFirstDependent(label, predicate) != null;
    }

    public boolean containsDependentByLabel(Pattern pattern) {
        return this.getFirstDependentByLabel(pattern) != null;
    }

    public boolean containsDependentByLabel(String label) {
        return this.getFirstDependent(label, (n, l) -> {
            return n.isDependencyLabel(l);
        }) != null;
    }

    public boolean isDescendantOf(N node) {
        for(N head = this.getDependencyHead(); head != null; head = head.getDependencyHead()) {
            if (head == node) {
                return true;
            }
        }

        return false;
    }

    public boolean isSiblingOf(N node) {
        return this.hasDependencyHead() && node.isDependentOf(this.dependency_head);
    }

    public List<DEPArc<N>> getSemanticHeadList() {
        return this.semantic_heads;
    }

    public List<DEPArc<N>> getSemanticHeadList(String label) {
        List<DEPArc<N>> list = new ArrayList();
        Iterator var3 = this.semantic_heads.iterator();

        while(var3.hasNext()) {
            DEPArc<N> arc = (DEPArc)var3.next();
            if (arc.isLabel(label)) {
                list.add(arc);
            }
        }

        return list;
    }

    public DEPArc<N> getSemanticHeadArc(N node) {
        Iterator var2 = this.semantic_heads.iterator();

        DEPArc arc;
        do {
            if (!var2.hasNext()) {
                return null;
            }

            arc = (DEPArc)var2.next();
        } while(!arc.isNode(node));

        return arc;
    }

    public DEPArc<N> getSemanticHeadArc(N node, String label) {
        Iterator var3 = this.semantic_heads.iterator();

        DEPArc arc;
        do {
            if (!var3.hasNext()) {
                return null;
            }

            arc = (DEPArc)var3.next();
        } while(!arc.equals(node, label));

        return arc;
    }

    public DEPArc<N> getSemanticHeadArc(N node, Pattern pattern) {
        Iterator var3 = this.semantic_heads.iterator();

        DEPArc arc;
        do {
            if (!var3.hasNext()) {
                return null;
            }

            arc = (DEPArc)var3.next();
        } while(!arc.equals(node, pattern));

        return arc;
    }

    public String getSemanticLabel(N node) {
        Iterator var2 = this.semantic_heads.iterator();

        DEPArc arc;
        do {
            if (!var2.hasNext()) {
                return null;
            }

            arc = (DEPArc)var2.next();
        } while(!arc.isNode(node));

        return arc.getLabel();
    }

    public N getFirstSemanticHead(String label) {
        Iterator var2 = this.semantic_heads.iterator();

        DEPArc arc;
        do {
            if (!var2.hasNext()) {
                return null;
            }

            arc = (DEPArc)var2.next();
        } while(!arc.isLabel(label));

        return (N) arc.getNode();
    }

    public N getFirstSemanticHead(Pattern pattern) {
        Iterator var2 = this.semantic_heads.iterator();

        DEPArc arc;
        do {
            if (!var2.hasNext()) {
                return null;
            }

            arc = (DEPArc)var2.next();
        } while(!arc.isLabel(pattern));

        return (N) arc.getNode();
    }

    public void addSemanticHeads(Collection<DEPArc<N>> arcs) {
        this.semantic_heads.addAll(arcs);
    }

    public void addSemanticHead(N head, String label) {
        this.addSemanticHead(new DEPArc(head, label));
    }

    public void addSemanticHead(DEPArc<N> arc) {
        this.semantic_heads.add(arc);
    }

    public void setSemanticHeads(List<DEPArc<N>> arcs) {
        this.semantic_heads = arcs;
    }

    public boolean removeSemanticHead(N node) {
        Iterator var2 = this.semantic_heads.iterator();

        DEPArc arc;
        do {
            if (!var2.hasNext()) {
                return false;
            }

            arc = (DEPArc)var2.next();
        } while(!arc.isNode(node));

        return this.semantic_heads.remove(arc);
    }

    public boolean removeSemanticHead(DEPArc<N> arc) {
        return this.semantic_heads.remove(arc);
    }

    public void removeSemanticHeads(Collection<DEPArc<N>> arcs) {
        this.semantic_heads.removeAll(arcs);
    }

    public void removeSemanticHeads(String label) {
        this.semantic_heads.removeAll(this.getSemanticHeadList(label));
    }

    public List<DEPArc<N>> clearSemanticHeads() {
        List<DEPArc<N>> backup = this.semantic_heads.subList(0, this.semantic_heads.size());
        this.semantic_heads.clear();
        return backup;
    }

    public boolean isArgumentOf(N node) {
        return this.getSemanticHeadArc(node) != null;
    }

    public boolean isArgumentOf(String label) {
        return this.getFirstSemanticHead(label) != null;
    }

    public boolean isArgumentOf(Pattern pattern) {
        return this.getFirstSemanticHead(pattern) != null;
    }

    public boolean isArgumentOf(N node, String label) {
        return this.getSemanticHeadArc(node, label) != null;
    }

    public boolean isArgumentOf(N node, Pattern pattern) {
        return this.getSemanticHeadArc(node, pattern) != null;
    }

    public List<Pair<N, N>> getArgumentCandidateList(int maxDepth, int maxHeight) {
        List<Pair<N, N>> list = new ArrayList();
        int endIndex = 0;
        N lca = this.self();
        Iterator var10 = lca.getDependentList().iterator();

        AbstractNLPNode node;
        while(var10.hasNext()) {
            node = (AbstractNLPNode)var10.next();
            list.add(new Pair(node, lca));
        }

        int i;
        for(i = 1; i < maxDepth && endIndex != list.size(); ++i) {
            int beginIndex = endIndex;
            endIndex = list.size();

            for(int j = beginIndex; j < endIndex; ++j) {
                var10 = ((AbstractNLPNode)((Pair)list.get(j)).o1).getDependentList().iterator();

                while(var10.hasNext()) {
                    node = (AbstractNLPNode)var10.next();
                    list.add(new Pair(node, lca));
                }
            }
        }

        for(i = 0; i < maxHeight; ++i) {
            N prev = lca;
            lca = lca.getDependencyHead();
            if (lca == null || !lca.hasDependencyHead()) {
                break;
            }

            list.add(new Pair(lca, lca));
            var10 = lca.getDependentList().iterator();

            while(var10.hasNext()) {
                node = (AbstractNLPNode)var10.next();
                if (node != prev) {
                    list.add(new Pair(node, lca));
                }
            }
        }

        return list;
    }

    public int compareTo(N node) {
        return this.id - node.id;
    }

    public String toString() {
        StringJoiner join = new StringJoiner(StringConst.TAB);
        join.add(Integer.toString(this.id));
        join.add(this.toString(this.word_form));
        join.add(this.toString(this.lemma));
        join.add(this.toString(this.pos_tag));
        join.add(this.feat_map.toString());
        this.toStringDependency(join);
        join.add(this.toStringSemantics(this.semantic_heads));
        join.add(this.toString(this.nament_tag));
        return join.toString();
    }

    private String toString(String s) {
        return s == null ? TSVReader.BLANK : s;
    }

    private void toStringDependency(StringJoiner join) {
        if (this.hasDependencyHead()) {
            join.add(Integer.toString(this.dependency_head.id));
            join.add(this.toString(this.dependency_label));
        } else {
            join.add(TSVReader.BLANK);
            join.add(TSVReader.BLANK);
        }

    }

    private <T extends AbstractArc<N>> String toStringSemantics(List<T> arcs) {
        if (arcs != null && !arcs.isEmpty()) {
            Collections.sort(arcs);
            return Joiner.join(arcs, ";");
        } else {
            return TSVReader.BLANK;
        }
    }

    public List<DEPArc<N>> getSecondaryHeadList() {
        return this.secondary_heads;
    }

    public void setSecondaryHeads(List<DEPArc<N>> heads) {
        this.secondary_heads = heads;
    }

    public void addSecondaryHead(DEPArc<N> head) {
        this.secondary_heads.add(head);
    }

    public void addSecondaryHead(N head, String label) {
        this.addSecondaryHead(new DEPArc(head, label));
    }
}