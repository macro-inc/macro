package com.macro.preprocess.nlp.learning;

import it.unimi.dsi.fastutil.ints.Int2IntMap;
import it.unimi.dsi.fastutil.objects.Object2IntMap;
import it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap;
import it.unimi.dsi.fastutil.objects.ObjectIterator;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class LabelMap implements Serializable {
    private static final long serialVersionUID = 6353276311284514969L;
    private Object2IntMap<String> index_map = new Object2IntOpenHashMap();
    private List<String> labels = new ArrayList();

    public LabelMap() {
    }

    public int add(String label) {
        int index = this.index(label);
        if (index < 0) {
            index = this.labels.size();
            this.index_map.put(label, index);
            this.labels.add(label);
        }

        return index;
    }

    public int index(String label) {
        return (Integer)this.index_map.getOrDefault(label, -1);
    }

    public String getLabel(int index) {
        return (String)this.labels.get(index);
    }

    public List<String> getLabelList() {
        return this.labels;
    }

    public int size() {
        return this.labels.size();
    }

    public String toString() {
        return this.labels.toString();
    }

    public void remap(Int2IntMap map) {
        this.index_map = new Object2IntOpenHashMap();
        List<String> list = new ArrayList();

        for(int i = 0; i < map.size(); ++i) {
            list.add(null);
        }

        ObjectIterator var8 = map.entrySet().iterator();

        while(var8.hasNext()) {
            Map.Entry<Integer, Integer> e = (Map.Entry)var8.next();
            int oIdx = (Integer)e.getKey();
            int nIdx = (Integer)e.getValue();
            String lb = (String)this.labels.get(oIdx);
            this.index_map.put(lb, nIdx);
            list.set(nIdx, lb);
        }

        this.labels = list;
    }
}