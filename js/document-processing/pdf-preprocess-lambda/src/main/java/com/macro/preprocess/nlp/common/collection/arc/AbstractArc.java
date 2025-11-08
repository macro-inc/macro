package com.macro.preprocess.nlp.common.collection.arc;

import java.io.Serializable;
import java.util.regex.Pattern;

public abstract class AbstractArc<N> implements Comparable<AbstractArc<N>>, Serializable {
    private static final long serialVersionUID = -2230309327619045746L;
    public static final String LABEL_DELIM = ":";
    public static final String ARC_DELIM = ";";
    protected N node;
    protected String label;

    public AbstractArc(N node, String label) {
        this.set(node, label);
    }

    public N getNode() {
        return this.node;
    }

    public String getLabel() {
        return this.label;
    }

    public void setNode(N node) {
        this.node = node;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public void clear() {
        this.set((N) null, (String)null);
    }

    public void set(N node, String label) {
        this.setNode(node);
        this.setLabel(label);
    }

    public boolean isNode(N node) {
        return this.node == node;
    }

    public boolean isLabel(String label) {
        return this.label.equals(label);
    }

    public boolean isLabel(Pattern pattern) {
        return this.label != null && pattern.matcher(this.label).find();
    }

    public boolean equals(N node, String label) {
        return this.isNode(node) && this.isLabel(label);
    }

    public boolean equals(N node, Pattern pattern) {
        return this.isNode(node) && this.isLabel(pattern);
    }
}
