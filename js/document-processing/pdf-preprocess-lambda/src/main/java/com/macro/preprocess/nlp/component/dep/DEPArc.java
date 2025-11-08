package com.macro.preprocess.nlp.component.dep;

import com.macro.preprocess.nlp.common.collection.arc.AbstractArc;
import com.macro.preprocess.nlp.node.AbstractNLPNode;

public class DEPArc<N extends AbstractNLPNode<N>> extends AbstractArc<N> {
    private static final long serialVersionUID = -9099516205158258095L;
    private double weight;

    public DEPArc(N node, String label) {
        super(node, label);
    }

    public double getWeight() {
        return this.weight;
    }

    public void setWeight(double weight) {
        this.weight = weight;
    }

    public String toString() {
        return ((AbstractNLPNode)this.node).getID() + ":" + this.label;
    }

    public int compareTo(AbstractArc<N> arc) {
        return ((AbstractNLPNode)this.node).compareTo((AbstractNLPNode)arc.getNode());
    }
}
