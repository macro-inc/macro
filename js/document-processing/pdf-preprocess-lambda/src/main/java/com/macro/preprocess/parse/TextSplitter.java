package com.macro.preprocess.parse;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

import com.macro.preprocess.component.logical.ai.DocumentData;
import com.macro.preprocess.component.logical.ai.PageData;
import com.macro.preprocess.component.logical.ai.Segment;
import com.macro.preprocess.component.logical.ai.TextBoxData;
import com.macro.preprocess.component.logical.ai.TextTokenData;

/**
 * Splits text into segments for input to a LLM model.
 * Specifically prioritizes not exceeding a maximum token count.
 * 
 * @author Gabriel Birman
 */
public class TextSplitter {

    /** Function that maps text to token count. */
    public interface TokenCounter extends Function<String, Integer> {}

    /** Configuration file */
    public static class TextSplitterConfig {
        private int maxTokens;
        private int tokenPad;
        private TokenCounter tokenCounter;
        private int minSegmentTokens;

        public TextSplitterConfig(int maxTokens, int tokenPad, TokenCounter tokenCounter) {
            this.maxTokens = maxTokens;
            this.tokenPad = tokenPad;
            this.tokenCounter = tokenCounter;
            this.minSegmentTokens = 0;
        }

        public TextSplitterConfig(int maxTokens, int tokenPad, TokenCounter tokenCounter, int minSegmentTokens) {
            this.maxTokens = maxTokens;
            this.tokenPad = tokenPad;
            this.tokenCounter = tokenCounter;
            this.minSegmentTokens = minSegmentTokens;
        }

        public int getMaxTokens() {
            return this.maxTokens;
        }

        public int getTokenPad() {
            return this.tokenPad;
        }

        public int getMinSegmentTokens() {
            return this.minSegmentTokens;
        }

        public TokenCounter getTokenCounter() {
            return this.tokenCounter;
        }

        public static class Builder {
            private int maxTokens = 100;
            private int tokenPad = 0;
            private TokenCounter tokenCounter;
            private int minSegmentTokens = 0;
    
            public Builder() {}
    
            /** Maximum number of tokens that can be set in a split segment */
            public Builder withMaxTokens(int maxTokens) {
                this.maxTokens = maxTokens;
                return this;
            }
    
            /** Token padding to be subtracte from max token number (helps with overflow) */
            public Builder withTokenPad(int tokenPad) {
                this.tokenPad = tokenPad;
                return this;
            }
    
            /** A function that maps text to token count */
            public Builder withTokenCounter(TokenCounter tokenCounter) {
                this.tokenCounter = tokenCounter;
                return this;
            }

            /** Minimum number of tokens in a split segment */
            public Builder withMinSegmentTokens(int minSegmentTokens) {
                this.minSegmentTokens = minSegmentTokens;
                return this;
            }
    
            public TextSplitterConfig build() {
                return new TextSplitterConfig(this.maxTokens, this.tokenPad, this.tokenCounter, this.minSegmentTokens);
            }
        }
    }

    public TextSplitter() {}

    public TextSplitter(TextSplitterConfig config) {
        this.textSplitterConfig = config;
    }

    private TextSplitterConfig textSplitterConfig;

    public TextSplitterConfig getTextSplitterConfig() {
        return this.textSplitterConfig;
    }

    public void setTextSplitterConfig(TextSplitterConfig textSplitterConfig) {
        this.textSplitterConfig = textSplitterConfig;
    }

    private void validateConfig() {
        if (this.textSplitterConfig == null) {
            throw new IllegalStateException("config is not set");
        }
        if (this.textSplitterConfig.getMaxTokens() == 0) {
            throw new IllegalStateException("Max tokens is not set in config");
        }
        if (this.textSplitterConfig.getTokenCounter() == null) {
            throw new IllegalStateException("Token counter is not set in config");
        }
        if (this.textSplitterConfig.getMinSegmentTokens() < 0) {
            throw new IllegalStateException("Min Segment Tokens is less than 0");
        }
    }

    /**
     * Extracts a list of ordered segments from a document that can be passed into a LLM model
     * without exceeding the maximum token count.
     * 
     * @param documentData document data to be split into segments
     * @return list of LLM segments
     */
    public List<Segment> segmentDocumentData(DocumentData documentData) {
        this.validateConfig();

        ArrayList<Segment> segments = new ArrayList<>();
        for (PageData pageData : documentData.getPageDatas()) {
            segments.addAll(this.segmentPageData(pageData));
        }
        return segments;
    }

    /**
     * Extracts a list of ordered segments from a page that can be passed into a LLM model
     * without exceeding the maximum token count.
     * 
     * @param pageData page data to be split into segments
     * @return list of LLM segments
     */
    public List<Segment> segmentPageData(PageData pageData) {
        this.validateConfig();

        int tokenLimit = this.textSplitterConfig.maxTokens - this.textSplitterConfig.tokenPad;
        int minSegmentTokens = this.textSplitterConfig.minSegmentTokens;
        TokenCounter tokenCounter = this.textSplitterConfig.tokenCounter;

        ArrayList<Segment> segments = new ArrayList<>();
        StringBuilder currentText = new StringBuilder();
        int currentPage = pageData.getPageNum() + 1; // 1-indexed
        float pageHeight = pageData.getPageHeight();
        float currentY = pageData.getPageHeight();
        int currentTokenCount = 0;

        for (TextBoxData textBoxData : pageData.getTextBoxDatas()) {
            String text = textBoxData.getText();
            int textTokenCount = tokenCounter.apply(text);
            currentY = Math.min(currentY, textBoxData.getY());

            // Check if adding space will exceed the max token count
            int spaceTokenCount = currentText.length() > 0 ? 1 : 0;

            if (currentTokenCount + textTokenCount + spaceTokenCount > tokenLimit) {
                // If adding this text would exceed the max token count,
                // create a new segment with the current text and start a new one
                Segment segment = new Segment.Builder()
                    .setText(currentText.toString())
                    .setPageNum(currentPage)
                    .setY(currentY)
                    .build();
                if (!currentText.toString().isEmpty() && currentTokenCount >= minSegmentTokens) {
                    segments.add(segment);
                    currentY = Float.MAX_VALUE;
                }

                // If the current text itself exceeds the token limit, split it across multiple segments
                if (textTokenCount > tokenLimit) {
                    
                    for (TextTokenData textTokenData : textBoxData.getTextTokenDatas()) { // add as many tokens as possible to the segment
                        String textTokenText = textTokenData.getText();
                        int currentTextTokenCount = tokenCounter.apply(textTokenText);
                        currentY = Math.min(currentY, textTokenData.getY());

                        if (currentTokenCount + currentTextTokenCount + spaceTokenCount > tokenLimit) {
                            // if the text token is still too long, discard it
                            // TODO: do we want to discard the token or split it?
                            // TODO: if we discard, do we want to add the next token to the existing segment or start a new one?
                            if (currentTextTokenCount > tokenLimit) {
                                continue;
                            }

                            segment = new Segment.Builder()
                                .setText(currentText.toString())
                                .setPageNum(currentPage)
                                .setY(currentY)
                                .build();
                            if (!currentText.toString().isEmpty() && currentTokenCount >= minSegmentTokens) {
                                segments.add(segment);
                                currentY = Float.MAX_VALUE;
                            }

                            // Start the new segment with the current box token's text
                            currentText = new StringBuilder(textTokenText);
                            currentTokenCount = currentTextTokenCount;
                            currentY = textTokenData.getY();
                        } else {
                            if (currentText.length() > 0) {
                                currentText.append(" ");  // add a space between texts
                                currentTokenCount += spaceTokenCount;
                            }
                            currentText.append(textTokenText);
                            currentTokenCount += currentTextTokenCount;
                        }
                    }

                } else { // Start the new segment with the current text
                    currentText = new StringBuilder(text);
                    currentTokenCount = textTokenCount;
                    currentY = textBoxData.getY();
                }
            
            } else {
                // If adding this box wouldn't exceed the max token count, 
                // append its text to the current segment
                // TODO: don't add space if the subsequent text is empty or has a space at the beginning
                if (currentText.length() > 0) {
                    currentText.append(" ");  // add a space between texts
                    currentTokenCount += spaceTokenCount;
                }
                currentText.append(text);
                currentTokenCount += textTokenCount;
            }
        }

        // If there is any remaining text that hasn't been added to a segment, add it now
        if (currentText.length() > 0) {
            Segment segment = new Segment.Builder()
                .setText(currentText.toString())
                .setPageNum(currentPage)
                .setY(currentY)
                .build();
            if (!currentText.toString().isEmpty() && currentTokenCount >= minSegmentTokens) {
                segments.add(segment);
            }
        }

        // Determine segment heights by looking at the next segment's y offset
        // TODO: use a more robust method that adds text box/token heights iteratively as this method may overshoot
        ArrayList<Segment> segmentsWithHeights = new ArrayList<>();
        for (int i = 0; i < segments.size(); i++) {
            Segment segment = segments.get(i);
            float height = 0;
            if (i < segments.size() - 1) {
                Segment nextSegment = segments.get(i + 1);
                height = nextSegment.getY() - segment.getY();
                // NOTE: this shouldn't happen because all segments are on the same page but is provided as a fallback measure
                if (height < 0) {
                    height = pageHeight - segment.getY();
                }
            } else {
                height = pageHeight - segment.getY();
            }
            segmentsWithHeights.add(segment.toBuilder().setHeight(height).build());
        }

        return segmentsWithHeights;
    }
}
