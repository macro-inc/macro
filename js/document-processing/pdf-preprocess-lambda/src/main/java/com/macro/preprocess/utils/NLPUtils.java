package com.macro.preprocess.utils;

import com.macro.preprocess.nlp.EnglishTokenizer;
import com.macro.preprocess.nlp.Tokenizer;
import com.macro.preprocess.nlp.component.dep.DEPArc;
import com.macro.preprocess.nlp.NLPComponent;
import com.macro.preprocess.nlp.component.template.OnlineComponent;
import com.macro.preprocess.nlp.component.template.feature.Field;
import com.macro.preprocess.nlp.node.AbstractNLPNode;
import com.macro.preprocess.nlp.node.NLPNode;
import com.macro.preprocess.nlp.component.template.state.NLPState;
import com.macro.preprocess.nlp.component.template.util.NLPFlag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.io.ObjectInputStream;
import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.function.Function;
import java.util.function.Supplier;

public class NLPUtils {
    public static final Logger LOG = LoggerFactory.getLogger(NLPUtils.class);
    public static String FEAT_POS_2ND = "pos2";
    public static String FEAT_PREDICATE = "pred";
    public static final String FEAT_SEM = "sem";
    public static final String FEAT_SYN = "syn";
    public static final String FEAT_SNT = "snt";
    public static final String FEAT_PB = "pb";
    public static final String FEAT_VN = "vn";
    public static final String FEAT_WS = "ws";
    public static final String FEAT_POS2 = "p2";
    public static final String FEAT_NER2 = "n2";
    public static final String FEAT_FUTURE = "fut";

    public NLPUtils() {
    }

    public static <N extends AbstractNLPNode<N>> String join(N[] nodes, String delim, Function<N, String> f) {
        return Joiner.join(nodes, delim, 1, nodes.length, f);
    }

    public static <N extends AbstractNLPNode<N>, S extends NLPState<N>> NLPComponent<N> getComponent(String pathname) {
        try {
            ObjectInputStream oin = IOUtils.createArtifactObjectInputStream(pathname);
            Throwable var2 = null;

            OnlineComponent var4;
            try {
                OnlineComponent<N, S> component = (OnlineComponent)oin.readObject();
                component.setFlag(NLPFlag.DECODE);
                var4 = component;
            } catch (Throwable var14) {
                var2 = var14;
                throw var14;
            } finally {
                if (oin != null) {
                    if (var2 != null) {
                        try {
                            oin.close();
                        } catch (Throwable var13) {
                            var2.addSuppressed(var13);
                        }
                    } else {
                        oin.close();
                    }
                }

            }

            return var4;
        } catch (Exception var16) {
            LOG.error("Failed to read component " + pathname, var16);
            throw new RuntimeException(var16);
        }
    }

    public static <N extends AbstractNLPNode<N>, S extends NLPState<N>> NLPComponent<N> getComponent(InputStream in) {
        ObjectInputStream oin = IOUtils.createObjectXZBufferedInputStream(in);
        OnlineComponent<N, S> component = null;

        try {
            component = (OnlineComponent)oin.readObject();
            component.setFlag(NLPFlag.DECODE);
            oin.close();
        } catch (Exception var4) {
            var4.printStackTrace();
        }

        return component;
    }

    public static Tokenizer createTokenizer(Language language) {
        return new EnglishTokenizer();
    }

    public static String toStringLine(NLPNode[] nodes, String delim, Field field) {
        return Joiner.join(nodes, delim, 1, nodes.length, (n) -> {
            return n.getValue(field);
        });
    }

    public static <N extends AbstractNLPNode<N>> List<List<DEPArc<N>>> getSemanticArgumentList(N[] nodes) {
        List<List<DEPArc<N>>> list = new ArrayList();

        int i;
        for(i = 0; i < nodes.length; ++i) {
            list.add(new ArrayList());
        }

        for(i = 1; i < nodes.length; ++i) {
            N node = nodes[i];
            Iterator var5 = node.getSemanticHeadList().iterator();

            while(var5.hasNext()) {
                DEPArc<N> arc = (DEPArc)var5.next();
                List<DEPArc<N>> args = (List)list.get(((AbstractNLPNode)arc.getNode()).getID());
                args.add(new DEPArc(node, arc.getLabel()));
            }
        }

        return list;
    }

    public static <N extends AbstractNLPNode<N>> boolean containsCycle(N[] tree) {
        for(int i = 1; i < tree.length; ++i) {
            N node = tree[i];
            if (node.hasDependencyHead() && node.getDependencyHead().isDescendantOf(node)) {
                return true;
            }
        }

        return false;
    }

    public static <N extends AbstractNLPNode<N>> N[] toDependencyTree(List<N> nodes, Supplier<N> sup) {
        N[] graph = (N[]) Array.newInstance(((AbstractNLPNode)nodes.get(0)).getClass(), nodes.size() + 1);
        graph[0] = ((N)sup.get()).toRoot();

        for(int i = 1; i < graph.length; ++i) {
            graph[i] = (N)nodes.get(i - 1);
        }

        return graph;
    }
}
