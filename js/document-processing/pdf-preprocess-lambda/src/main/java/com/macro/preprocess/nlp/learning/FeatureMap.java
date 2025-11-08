package com.macro.preprocess.nlp.learning;

import com.macro.preprocess.utils.DSUtils;
import it.unimi.dsi.fastutil.ints.IntIterator;
import it.unimi.dsi.fastutil.objects.Object2IntMap;
import it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

public class FeatureMap implements Serializable {
    private static final long serialVersionUID = 6496256881514652478L;
    private List<Object2IntMap<String>> index_map;
    private int feature_size;

    public FeatureMap() {
        this(1);
    }

    public FeatureMap(int beginIndex) {
        this.index_map = new ArrayList();
        this.feature_size = beginIndex;
    }

    public int add(int type, String value) {
        for(int i = this.index_map.size(); i <= type; ++i) {
            this.index_map.add(new Object2IntOpenHashMap());
        }

        Object2IntMap<String> map = (Object2IntMap)this.index_map.get(type);
        int index = (Integer)map.getOrDefault(value, -1);
        if (index < 0) {
            index = this.feature_size++;
            map.put(value, index);
        }

        return index;
    }

    public int index(int type, String value) {
        return DSUtils.isRange(this.index_map, type) ? (Integer)((Object2IntMap)this.index_map.get(type)).getOrDefault(value, -1) : -1;
    }

    public int size() {
        return this.feature_size;
    }

    public List<Object2IntMap<String>> getIndexMaps() {
        return this.index_map;
    }

    public void setSize(int size) {
        this.feature_size = size;
    }

    public int getMaxIndex() {
        int max = -1;
        Iterator var2 = this.index_map.iterator();

        while(var2.hasNext()) {
            Object2IntMap<String> map = (Object2IntMap)var2.next();

            int index;
            for(IntIterator var4 = map.values().iterator(); var4.hasNext(); max = Math.max(max, index)) {
                index = (Integer)var4.next();
            }
        }

        return max;
    }

    public String toString() {
        return this.index_map.toString();
    }
}
