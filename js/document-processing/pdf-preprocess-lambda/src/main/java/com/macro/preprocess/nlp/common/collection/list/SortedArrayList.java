package com.macro.preprocess.nlp.common.collection.list;

import java.io.Serializable;
import java.util.Collection;
import java.util.Collections;
import java.util.Iterator;
import org.magicwerk.brownies.collections.GapList;

public class SortedArrayList<T extends Comparable<T>> extends GapList<T> implements Serializable, Iterable<T> {
    private static final long serialVersionUID = 3219296829240273911L;
    private boolean b_ascending;

    public SortedArrayList() {
        this.setDirection(true);
    }

    public SortedArrayList(int initialCapacity) {
        super(initialCapacity);
        this.setDirection(true);
    }

    public SortedArrayList(boolean ascending) {
        this.setDirection(ascending);
    }

    public SortedArrayList(int initialCapacity, boolean ascending) {
        super(initialCapacity);
        this.setDirection(ascending);
    }

    private void setDirection(boolean ascending) {
        this.b_ascending = ascending;
    }

    public boolean add(T e) {
        int index = this.getInsertIndex(e);
        super.add(index, e);
        return true;
    }

    public int addItem(T e) {
        int index = this.getInsertIndex(e);
        super.add(index, e);
        return index;
    }

    public boolean addAll(Collection<? extends T> c) {
        Iterator var2 = c.iterator();

        while(var2.hasNext()) {
            T t = (T) var2.next();
            this.add(t);
        }

        return true;
    }

    public int remove(T item) {
        int index = this.indexOf(item);
        if (index >= 0) {
            super.remove(index);
        }

        return index;
    }

    public boolean contains(T item) {
        return this.indexOf(item) >= 0;
    }

    public int indexOf(T item) {
        return this.b_ascending ? Collections.binarySearch(this, item) : Collections.binarySearch(this, item, Collections.reverseOrder());
    }

    public int getInsertIndex(T item) {
        int index = this.indexOf(item);
        return index < 0 ? -(index + 1) : index + 1;
    }
}

