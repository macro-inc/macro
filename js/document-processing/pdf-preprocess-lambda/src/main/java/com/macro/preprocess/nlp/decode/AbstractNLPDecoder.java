package com.macro.preprocess.nlp.decode;

import com.macro.preprocess.nlp.Tokenizer;
import com.macro.preprocess.nlp.constants.StringConst;
import com.macro.preprocess.nlp.token.Token;
import com.macro.preprocess.utils.FileUtils;
import com.macro.preprocess.utils.IOUtils;
import com.macro.preprocess.utils.Joiner;
import com.macro.preprocess.utils.NLPUtils;
import com.macro.preprocess.utils.Language;
import com.macro.preprocess.nlp.morph.MorphologicalAnalyzer;
import com.macro.preprocess.nlp.NLPComponent;
import com.macro.preprocess.nlp.lexicon.GlobalLexica;
import com.macro.preprocess.nlp.node.AbstractNLPNode;
import com.macro.preprocess.nlp.reader.TSVReader;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Function;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class AbstractNLPDecoder<N extends AbstractNLPNode<N>> {
    private static final Logger LOG = LoggerFactory.getLogger(AbstractNLPDecoder.class);
    public static final String FORMAT_RAW = "raw";
    public static final String FORMAT_LINE = "line";
    public static final String FORMAT_TSV = "tsv";
    private volatile List<NLPComponent<N>> components;
    private volatile Tokenizer tokenizer;
    private DecodeConfig decode_config;

    public AbstractNLPDecoder() {
    }

    public AbstractNLPDecoder(DecodeConfig config) {
        this.init(config);
    }

    public AbstractNLPDecoder(InputStream configuration) {
        this.init(new DecodeConfig(configuration));
    }

    public void init(DecodeConfig config) {
        List<NLPComponent<N>> components = new ArrayList();
        Language language = config.getLanguage();
        this.decode_config = config;
        components.add(new GlobalLexica(this.decode_config.getDocumentElement()));
        LOG.info("Loading tokenizer");
        this.setTokenizer(NLPUtils.createTokenizer(language));
        if (this.decode_config.getPartOfSpeechTagging() != null) {
            LOG.info("Loading part-of-speech tagger");
            components.add(NLPUtils.getComponent(this.decode_config.getPartOfSpeechTagging()));
            LOG.info("Loading morphological analyzer");
            components.add(new MorphologicalAnalyzer(language));
        }

        if (this.decode_config.getNamedEntityRecognition() != null) {
            LOG.info("Loading named entity recognizer");
            components.add(NLPUtils.getComponent(this.decode_config.getNamedEntityRecognition()));
        }

        if (this.decode_config.getDependencyParsing() != null) {
            LOG.info("Loading dependency parser");
            components.add(NLPUtils.getComponent(this.decode_config.getDependencyParsing()));
        }

        this.setComponents(components);
    }

    public Tokenizer getTokenizer() {
        return this.tokenizer;
    }

    public List<NLPComponent<N>> getComponents() {
        return this.components;
    }

    public void setTokenizer(Tokenizer tokenizer) {
        this.tokenizer = tokenizer;
    }

    public void setComponents(List<NLPComponent<N>> components) {
        this.components = components;
    }

    public void decode(List<String> inputFiles, String outputExt, String format, int threads) {
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        Iterator var7 = inputFiles.iterator();

        while(var7.hasNext()) {
            String inputFile = (String)var7.next();
            String outputFile = inputFile + StringConst.PERIOD + outputExt;
            executor.submit(new AbstractNLPDecoder.NLPTask(inputFile, outputFile, format));
        }

        executor.shutdown();
    }

    public String decode(String s, String format) {
        return new String(this.decodeByteArray(s, format));
    }

    public byte[] decodeByteArray(String s, String format) {
        InputStream bin = new ByteArrayInputStream(s.getBytes());
        ByteArrayOutputStream bout = new ByteArrayOutputStream();
        this.decode(bin, bout, format);

        try {
            bin.close();
            bout.close();
        } catch (IOException var6) {
            var6.printStackTrace();
        }

        return bout.toByteArray();
    }

    public void decode(InputStream in, OutputStream out, String format) {
        try {
            switch (format) {
                case "raw":
                    this.decodeRaw(in, out);
                    break;
                case "line":
                    this.decodeLine(in, out);
                    break;
                case "tsv":
                    this.decodeTSV(this.createTSVReader(), in, out);
            }
        } catch (Exception var6) {
            var6.printStackTrace();
        }

    }

    public List<N[]> decodeDocument(String s) throws IOException {
        return this.decodeDocument((InputStream)(new ByteArrayInputStream(s.getBytes())));
    }

    public List<N[]> decodeDocument(InputStream in) throws IOException {
        List<N[]> document = new ArrayList();
        Iterator var4 = this.tokenizer.segmentize(in).iterator();

        while(var4.hasNext()) {
            List<Token> tokens = (List)var4.next();
            N[] nodes = this.toNodeArray(tokens);
            this.decode(nodes);
            document.add(nodes);
        }

        in.close();
        return document;
    }

    public void decodeRaw(String s, OutputStream out) throws IOException {
        this.decodeRaw((InputStream)(new ByteArrayInputStream(s.getBytes())), out);
    }

    public void decodeRaw(InputStream in, OutputStream out) throws IOException {
        PrintStream fout = IOUtils.createBufferedPrintStream(out);
        Iterator var5 = this.tokenizer.segmentize(in).iterator();

        while(var5.hasNext()) {
            List<Token> tokens = (List)var5.next();
            N[] nodes = this.toNodeArray(tokens);
            this.decode(nodes);
            fout.println(this.toString(nodes) + "\n");
        }

        in.close();
        fout.close();
    }

    public void decodeLine(InputStream in, OutputStream out) throws IOException {
        BufferedReader reader = IOUtils.createBufferedReader(in);
        PrintStream fout = IOUtils.createBufferedPrintStream(out);

        String line;
        while((line = reader.readLine()) != null) {
            N[] nodes = this.decode(line);
            fout.println(this.toString(nodes) + "\n");
        }

        reader.close();
        fout.close();
    }

    public void decodeTSV(TSVReader<N> reader, InputStream in, OutputStream out) throws IOException {
        PrintStream fout = IOUtils.createBufferedPrintStream(out);
        reader.open(in);

        AbstractNLPNode[] nodes;
        while((nodes = reader.next()) != null) {
            this.decode((N[]) nodes);
            fout.println(this.toString((N[]) nodes) + "\n");
        }

        reader.close();
        fout.close();
    }

    public N[] decode(String sentence) {
        List<Token> tokens = this.tokenizer.tokenize(sentence);
        return this.decode(this.toNodeArray(tokens));
    }

    public N[] decode(N[] nodes) {
        Iterator var2 = this.components.iterator();

        while(var2.hasNext()) {
            NLPComponent<N> component = (NLPComponent)var2.next();
            component.process(nodes);
        }

        return nodes;
    }

    public N[] toNodeArray(List<Token> tokens) {
        return this.toNodeArray(tokens, (t) -> {
            return this.create(t);
        });
    }

    public <T extends Token> N[] toNodeArray(List<T> tokens, Function<T, N> f) {
        N node = this.create();
        node.toRoot();
        N[] nodes = (N[])((AbstractNLPNode[])Array.newInstance(node.getClass(), tokens.size() + 1));
        nodes[0] = node;
        int i = 0;

        for(int j = 1; i < tokens.size(); ++j) {
            nodes[j] = (N) f.apply(tokens.get(i));
            nodes[j].setID(j);
            ++i;
        }

        return nodes;
    }

    public abstract N create();

    public N create(Token token) {
        N node = this.create();
        node.setWordForm(token.getWordForm());
        node.setStartOffset(token.getStartOffset());
        node.setEndOffset(token.getEndOffset());
        return node;
    }

    public TSVReader<N> createTSVReader() {
        return new TSVReader<N>(this.decode_config.getReaderFieldMap()) {
            protected N create() {
                return AbstractNLPDecoder.this.create();
            }
        };
    }

    public String toString(N[] nodes) {
        return Joiner.join(nodes, "\n", 1);
    }

    class NLPTask implements Runnable {
        private String input_file;
        private String output_file;
        private String format;

        public NLPTask(String inputFile, String outputFile, String format) {
            this.input_file = inputFile;
            this.output_file = outputFile;
            this.format = format;
        }

        public void run() {
            AbstractNLPDecoder.LOG.info(FileUtils.getBaseName(this.input_file));
            InputStream in = IOUtils.createFileInputStream(this.input_file);
            OutputStream out = IOUtils.createFileOutputStream(this.output_file);
            AbstractNLPDecoder.this.decode(in, out, this.format);
        }
    }
}