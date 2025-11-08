package com.macro.preprocess.nlp.component.template.config;

import com.macro.preprocess.nlp.learning.util.activation.*;
import com.macro.preprocess.utils.Language;
import com.macro.preprocess.utils.Splitter;
import com.macro.preprocess.nlp.common.util.XMLUtils;
import com.macro.preprocess.nlp.node.AbstractNLPNode;
import com.macro.preprocess.nlp.component.template.train.HyperParameter;
import com.macro.preprocess.nlp.component.template.train.LOLS;
import com.macro.preprocess.nlp.learning.optimization.reguralization.RegularizedDualAveraging;
import com.macro.preprocess.nlp.learning.util.initialization.RandomWeightGenerator;
import com.macro.preprocess.nlp.learning.util.initialization.WeightGenerator;
import it.unimi.dsi.fastutil.objects.Object2IntMap;
import it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.InputStream;
import java.util.Arrays;

public class NLPConfig<N extends AbstractNLPNode<N>> implements ConfigXML {
    protected Object2IntMap<String> reader_map;
    protected Element xml;

    public NLPConfig() {
    }

    public NLPConfig(InputStream in) {
        this.xml = XMLUtils.getDocumentElement(in);
    }

    public Element getDocumentElement() {
        return this.xml;
    }

    public int getIntegerTextContent(String tagName) {
        return XMLUtils.getIntegerTextContentFromFirstElementByTagName(this.xml, tagName);
    }

    public String getTextContent(String tagName) {
        return XMLUtils.getTextContentFromFirstElementByTagName(this.xml, tagName);
    }

    public Language getLanguage() {
        String language = XMLUtils.getTextContentFromFirstElementByTagName(this.xml, "language");
        return language == null ? Language.ENGLISH : Language.getType(language);
    }

    public Object2IntMap<String> getReaderFieldMap() {
        Element eTSV = XMLUtils.getFirstElementByTagName(this.xml, "tsv");
        NodeList list = eTSV.getElementsByTagName("column");
        int size = list.getLength();
        Object2IntMap<String> map = new Object2IntOpenHashMap();

        for(int i = 0; i < size; ++i) {
            Element element = (Element)list.item(i);
            String field = XMLUtils.getTrimmedAttribute(element, "field");
            int index = XMLUtils.getIntegerAttribute(element, "index");
            map.put(field, index);
        }

        return map;
    }

    public Element getFeatureTemplateElement() {
        return XMLUtils.getFirstElementByTagName(this.xml, "feature_template");
    }

    public HyperParameter getHyperParameter() {
        Element eOptimizer = XMLUtils.getFirstElementByTagName(this.xml, "optimizer");
        Element eLOLS = XMLUtils.getFirstElementByTagName(eOptimizer, "lols");
        int feautureCutoff = XMLUtils.getIntegerTextContentFromFirstElementByTagName(eOptimizer, "feature_cutoff");
        int batchSize = XMLUtils.getIntegerTextContentFromFirstElementByTagName(eOptimizer, "batch_size");
        int maxEpoch = XMLUtils.getIntegerTextContentFromFirstElementByTagName(eOptimizer, "max_epoch");
        float learningRate = XMLUtils.getFloatTextContentFromFirstElementByTagName(eOptimizer, "learning_rate");
        float decayingRate = XMLUtils.getFloatTextContentFromFirstElementByTagName(eOptimizer, "decaying_rate");
        float bias = XMLUtils.getFloatTextContentFromFirstElementByTagName(eOptimizer, "bias");
        float l1 = XMLUtils.getFloatTextContentFromFirstElementByTagName(eOptimizer, "l1_regularization");
        double decaying;
        int fixed;
        if (eLOLS != null) {
            fixed = XMLUtils.getIntegerAttribute(eLOLS, "fixed");
            decaying = XMLUtils.getDoubleAttribute(eLOLS, "decaying");
        } else {
            fixed = 0;
            decaying = 1.0;
        }

        RegularizedDualAveraging rda = l1 > 0.0F ? new RegularizedDualAveraging(l1) : null;
        HyperParameter hp = new HyperParameter();
        hp.setFeature_cutoff(feautureCutoff);
        hp.setBatchSize(batchSize);
        hp.setMaxEpochs(maxEpoch);
        hp.setLearningRate(learningRate);
        hp.setDecayingRate(decayingRate);
        hp.setBias(bias);
        hp.setL1Regularizer(rda);
        hp.setLOLS(new LOLS(fixed, decaying));
        hp.setHiddenDimensions(this.getHiddenDimensions(eOptimizer));
        hp.setActivationFunctions(this.getActivationFunction(eOptimizer));
        hp.setDropoutProb(this.getDropoutProb(eOptimizer));
        hp.setWeightGenerator(this.getWeightGenerator(eOptimizer));
        return hp;
    }

    private int[] getHiddenDimensions(Element eOptimizer) {
        String hidden = XMLUtils.getTextContentFromFirstElementByTagName(eOptimizer, "hidden_dimensions");
        if (hidden != null && !hidden.isEmpty()) {
            String[] t = Splitter.splitCommas(hidden);
            return Arrays.stream(t).mapToInt(Integer::parseInt).toArray();
        } else {
            return null;
        }
    }

    private ActivationFunction[] getActivationFunction(Element eOptimizer) {
        String activation = XMLUtils.getTextContentFromFirstElementByTagName(eOptimizer, "activation_functions");
        if (activation != null && !activation.isEmpty()) {
            String[] t = Splitter.splitCommas(activation);
            ActivationFunction[] functions = new ActivationFunction[t.length];

            for(int i = 0; i < t.length; ++i) {
                switch (t[i]) {
                    case "sigmoid":
                        functions[i] = new SigmoidFunction();
                        break;
                    case "softmax":
                        functions[i] = new SoftmaxFunction();
                        break;
                    case "identity":
                        functions[i] = new IdentityFunction();
                        break;
                    case "relu":
                        functions[i] = new RectifiedLinearUnitFunction();
                        break;
                    case "tanh":
                        functions[i] = new HyperbolicTanFunction();
                        break;
                    case "softplus":
                        functions[i] = new SoftplusFunction();
                }
            }

            return functions;
        } else {
            return null;
        }
    }

    private float[] getDropoutProb(Element eOptimizer) {
        String prob = XMLUtils.getTextContentFromFirstElementByTagName(eOptimizer, "dropout_prob");
        if (prob != null && !prob.isEmpty()) {
            String[] t = Splitter.splitCommas(prob);
            float[] dropout_prob = new float[t.length];

            for(int i = 0; i < t.length; ++i) {
                dropout_prob[i] = Float.parseFloat(t[i]);
            }

            return dropout_prob;
        } else {
            return null;
        }
    }

    private WeightGenerator getWeightGenerator(Element eOptimizer) {
        Element element = XMLUtils.getFirstElementByTagName(eOptimizer, "weight_generator");
        if (element == null) {
            return null;
        } else {
            float lower = Float.parseFloat(XMLUtils.getTrimmedAttribute(element, "lower"));
            float upper = Float.parseFloat(XMLUtils.getTrimmedAttribute(element, "upper"));
            return new RandomWeightGenerator(lower, upper);
        }
    }
}
