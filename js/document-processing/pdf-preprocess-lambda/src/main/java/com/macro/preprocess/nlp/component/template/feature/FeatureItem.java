package com.macro.preprocess.nlp.component.template.feature;

import java.io.Serializable;

public class FeatureItem implements Serializable {
    private static final long serialVersionUID = 7297765746466162241L;
    public Source source;
    public Relation relation;
    public int window;
    public Field field;
    public Object attribute;

    public FeatureItem(Source source, Relation relation, int window, Field field, Object attribute) {
        this.source = source;
        this.relation = relation;
        this.window = window;
        this.field = field;
        this.attribute = attribute;
    }

    public Source getSource() {
        return this.source;
    }

    public void setSource(Source source) {
        this.source = source;
    }

    public Relation getRelation() {
        return this.relation;
    }

    public void setRelation(Relation relation) {
        this.relation = relation;
    }

    public int getWindow() {
        return this.window;
    }

    public void setWindow(int window) {
        this.window = window;
    }

    public Field getField() {
        return this.field;
    }

    public void setField(Field field) {
        this.field = field;
    }

    public Object getAttribute() {
        return this.attribute;
    }

    public void setAttribute(Object attribute) {
        this.attribute = attribute;
    }

    public String toString() {
        return String.format("%s: source=%s, relation=%s, attribute=%s, window=%d", this.field, this.source, this.relation, this.attribute, this.window);
    }
}