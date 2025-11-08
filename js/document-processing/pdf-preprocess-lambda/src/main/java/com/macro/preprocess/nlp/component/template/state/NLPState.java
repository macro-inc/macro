package com.macro.preprocess.nlp.component.template.state;

import com.macro.preprocess.nlp.component.template.eval.Eval;
import com.macro.preprocess.nlp.component.template.feature.FeatureItem;
import com.macro.preprocess.nlp.component.template.feature.Relation;
import com.macro.preprocess.nlp.node.AbstractNLPNode;
import com.macro.preprocess.nlp.learning.LabelMap;

import java.util.List;

public abstract class NLPState<N extends AbstractNLPNode<N>> {
    protected List<N[]> document;
    protected N[] nodes;

    public NLPState(N[] nodes) {
        this.setNodes(nodes);
    }

    public NLPState(List<N[]> document) {
        this.setDocument(document);
    }

    public abstract boolean saveOracle();

    public abstract String getOracle();

    public abstract void resetOracle();

    public abstract void next(LabelMap var1, int[] var2, float[] var3);

    public abstract boolean isTerminate();

    public abstract N getNode(FeatureItem var1);

    public abstract void evaluate(Eval var1);

    public N[] getNodes() {
        return this.nodes;
    }

    public void setNodes(N[] nodes) {
        this.nodes = nodes;
    }

    public List<N[]> getDocument() {
        return this.document;
    }

    public void setDocument(List<N[]> document) {
        this.document = document;
    }

    public N getNode(int index) {
        return this.getNode(index, 0, false);
    }

    public N getNode(int index, int window) {
        return this.getNode(index, window, false);
    }

    public N getNode(int index, int window, Relation relation) {
        return this.getRelativeNode(this.getNode(index, window), relation);
    }

    public N getNode(int index, int window, boolean includeRoot) {
        index += window;
        int begin = includeRoot ? 0 : 1;
        return begin <= index && index < this.nodes.length ? this.nodes[index] : null;
    }

    public N getRelativeNode(N node, Relation relation) {
        if (node != null && relation != null) {
            switch (relation) {
                case h:
                    return node.getDependencyHead();
                case h2:
                    return node.getGrandDependencyHead();
                case lmd:
                    return node.getLeftMostDependent();
                case lmd2:
                    return node.getLeftMostDependent(1);
                case lnd:
                    return node.getLeftNearestDependent();
                case lnd2:
                    return node.getLeftNearestDependent(1);
                case lns:
                    return node.getLeftNearestSibling();
                case lns2:
                    return node.getLeftNearestSibling(1);
                case rmd:
                    return node.getRightMostDependent();
                case rmd2:
                    return node.getRightMostDependent(1);
                case rnd:
                    return node.getRightNearestDependent();
                case rnd2:
                    return node.getRightNearestDependent(1);
                case rns:
                    return node.getRightNearestSibling();
                case rns2:
                    return node.getRightNearestSibling(1);
                default:
                    return null;
            }
        } else {
            return node;
        }
    }

    public N getRelativeNode(FeatureItem item, N node) {
        return this.getRelativeNode(node, item.relation);
    }

    public boolean isFirst(N node) {
        return this.nodes[1] == node;
    }

    public boolean isLast(N node) {
        return this.nodes[this.nodes.length - 1] == node;
    }
}