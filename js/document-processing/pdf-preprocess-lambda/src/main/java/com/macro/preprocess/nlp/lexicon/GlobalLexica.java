package com.macro.preprocess.nlp.lexicon;

import com.macro.preprocess.nlp.collection.tree.PrefixTree;
import com.macro.preprocess.nlp.collection.tuple.ObjectIntIntTriple;
import com.macro.preprocess.utils.IOUtils;
import com.macro.preprocess.nlp.common.util.XMLUtils;
import com.macro.preprocess.nlp.NLPComponent;
import com.macro.preprocess.nlp.component.template.feature.Field;
import com.macro.preprocess.nlp.node.AbstractNLPNode;
import java.io.InputStream;
import java.io.ObjectInputStream;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.macro.preprocess.nlp.component.template.util.BILOU;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.w3c.dom.Element;

public class GlobalLexica<N extends AbstractNLPNode<N>> implements NLPComponent<N> {
    private static final Logger LOG = LoggerFactory.getLogger(GlobalLexica.class);
    public static final String LEXICA = "lexica";
    public static final String FIELD = "field";
    public static final String NAME = "name";
    protected GlobalLexicon<Map<String, List<String>>> ambiguity_classes;
    protected GlobalLexicon<Map<String, Set<String>>> word_clusters;
    protected GlobalLexicon<Map<String, float[]>> word_embeddings;
    protected GlobalLexicon<PrefixTree<String, Set<String>>> named_entity_gazetteers;
    protected GlobalLexicon<Set<String>> stop_words;

    public GlobalLexica(InputStream in) {
        this(XMLUtils.getDocumentElement(in));
    }

    public GlobalLexica(Element doc) {
        Element eLexica = XMLUtils.getFirstElementByTagName(doc, "lexica");
        if (eLexica != null) {
            this.setAmbiguityClasses(this.getGlobalLexicon(eLexica, "ambiguity_classes", "Loading ambiguity classes"));
            this.setWordClusters(this.getGlobalLexicon(eLexica, "word_clusters", "Loading word clusters"));
            this.setWordEmbeddings(this.getGlobalLexicon(eLexica, "word_embeddings", "Loading word embeddings"));
            this.setNamedEntityGazetteers(this.getGlobalLexicon(eLexica, "named_entity_gazetteers", "Loading named entity gazetteers"));
            this.setStopWords(this.getGlobalLexicon(eLexica, "stop_words", "Loading stop words"));
        }
    }

    protected <T> GlobalLexicon<T> getGlobalLexicon(Element eLexica, String tag, String message) {
        return this.getGlobalLexicon(XMLUtils.getFirstElementByTagName(eLexica, tag), message);
    }

    protected <T> GlobalLexicon<T> getGlobalLexicon(Element element, String message) {
        if (element == null) {
            return null;
        } else {
            LOG.info(message);
            String path = XMLUtils.getTrimmedTextContent(element);
            Field field = Field.valueOf(XMLUtils.getTrimmedAttribute(element, "field"));
            String name = XMLUtils.getTrimmedAttribute(element, "name");
            T lexicon = null;

            try {
                ObjectInputStream oin = IOUtils.createArtifactObjectInputStream(path);
                Throwable var8 = null;

                try {
                    lexicon = (T) oin.readObject();
                } catch (Throwable var18) {
                    var8 = var18;
                    throw var18;
                } finally {
                    if (oin != null) {
                        if (var8 != null) {
                            try {
                                oin.close();
                            } catch (Throwable var17) {
                                var8.addSuppressed(var17);
                            }
                        } else {
                            oin.close();
                        }
                    }

                }
            } catch (Exception var20) {
                var20.printStackTrace();
            }

            return new GlobalLexicon(lexicon, field, name);
        }
    }

    public GlobalLexicon<Map<String, List<String>>> getAmbiguityClasses() {
        return this.ambiguity_classes;
    }

    public void setAmbiguityClasses(GlobalLexicon<Map<String, List<String>>> classes) {
        this.ambiguity_classes = classes;
    }

    public GlobalLexicon<Map<String, Set<String>>> getWordClusters() {
        return this.word_clusters;
    }

    public void setWordClusters(GlobalLexicon<Map<String, Set<String>>> p) {
        this.word_clusters = p;
    }

    public GlobalLexicon<Map<String, float[]>> getWordEmbeddings() {
        return this.word_embeddings;
    }

    public void setWordEmbeddings(GlobalLexicon<Map<String, float[]>> embeddings) {
        this.word_embeddings = embeddings;
    }

    public GlobalLexicon<PrefixTree<String, Set<String>>> getNamedEntityGazetteers() {
        return this.named_entity_gazetteers;
    }

    public void setNamedEntityGazetteers(GlobalLexicon<PrefixTree<String, Set<String>>> gazetteers) {
        this.named_entity_gazetteers = gazetteers;
    }

    public GlobalLexicon<Set<String>> getStopWords() {
        return this.stop_words;
    }

    public void setStopWords(GlobalLexicon<Set<String>> stopwords) {
        this.stop_words = stopwords;
    }

    public void process(List<N[]> document) {
        Iterator var2 = document.iterator();

        while(var2.hasNext()) {
            N[] nodes = (N[]) var2.next();
            this.process(nodes);
        }

    }

    public void process(N[] nodes) {
        this.processAmbiguityClasses(nodes);
        this.processWordClusters(nodes);
        this.processWordEmbeddings(nodes);
        this.processNamedEntityGazetteers(nodes);
        this.processStopWords(nodes);
    }

    public void processAmbiguityClasses(N[] nodes) {
        if (this.ambiguity_classes != null) {
            for(int i = 1; i < nodes.length; ++i) {
                N node = nodes[i];
                List<String> list = (List)((Map)this.ambiguity_classes.getLexicon()).get(this.getKey(node, this.ambiguity_classes.getField()));
                node.setAmbiguityClasses(list);
            }

        }
    }

    public void processWordClusters(N[] nodes) {
        if (this.word_clusters != null) {
            for(int i = 1; i < nodes.length; ++i) {
                N node = nodes[i];
                Set<String> set = (Set)((Map)this.word_clusters.getLexicon()).get(this.getKey(node, this.word_clusters.getField()));
                node.setWordClusters(set);
            }

        }
    }

    public void processWordEmbeddings(N[] nodes) {
        if (this.word_embeddings != null) {
            for(int i = 1; i < nodes.length; ++i) {
                N node = nodes[i];
                float[] embedding = (float[])((Map)this.word_embeddings.getLexicon()).get(this.getKey(node, this.word_embeddings.getField()));
                node.setWordEmbedding(embedding);
            }

        }
    }

    public void processNamedEntityGazetteers(N[] nodes) {
        if (this.named_entity_gazetteers != null) {
            List<ObjectIntIntTriple<Set<String>>> list = ((PrefixTree)this.named_entity_gazetteers.getLexicon()).getAll(nodes, 1, (n) -> {
                return this.getKey((N) n, this.named_entity_gazetteers.getField());
            }, false, false);
            Iterator var3 = list.iterator();

            label36:
            while(var3.hasNext()) {
                ObjectIntIntTriple<Set<String>> t = (ObjectIntIntTriple)var3.next();
                Iterator var5 = ((Set)t.o).iterator();

                while(true) {
                    while(true) {
                        if (!var5.hasNext()) {
                            continue label36;
                        }

                        String tag = (String)var5.next();
                        if (t.i1 == t.i2) {
                            nodes[t.i1].addNamedEntityGazetteer(BILOU.toBILOUTag(BILOU.U, tag));
                        } else {
                            nodes[t.i1].addNamedEntityGazetteer(BILOU.toBILOUTag(BILOU.B, tag));
                            nodes[t.i2].addNamedEntityGazetteer(BILOU.toBILOUTag(BILOU.L, tag));

                            for(int j = t.i1 + 1; j < t.i2; ++j) {
                                nodes[j].addNamedEntityGazetteer(BILOU.toBILOUTag(BILOU.I, tag));
                            }
                        }
                    }
                }
            }

        }
    }

    public void processStopWords(N[] nodes) {
        if (this.stop_words != null) {
            for(int i = 1; i < nodes.length; ++i) {
                N node = nodes[i];
                node.setStopWord(((Set)this.stop_words.getLexicon()).contains(this.getKey(node, this.stop_words.getField())));
            }

        }
    }

    protected String getKey(N node, Field field) {
        return node.getValue(field);
    }
}
