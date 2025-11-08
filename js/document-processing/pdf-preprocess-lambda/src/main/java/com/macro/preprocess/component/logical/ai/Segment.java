package com.macro.preprocess.component.logical.ai;

import org.json.JSONObject;

/** Represents an LLM Segment */
public class Segment {
    private String text;
    private int pageNum;
    private float y;
    private float height;

    private Segment(Builder builder) {
        this.text = builder.text;
        this.pageNum = builder.pageNum;
        this.y = builder.y;
        this.height = builder.height;
    }

    /**
     * @return the text in the chunk
     */
    public String getText() {
        return text;
    }

    /**
     * @return the page number of the page (1-indexed)
     */
    public int getPageNum() {
        return pageNum;
    }


    /**
     * @return the y offset of the chunk in the page
     */
    public float getY() {
        return y;
    }

    /**
     * @return the height of the chunk
     */
    public float getHeight() {
        return height;
    }

    public Builder toBuilder() {
        return new Builder()
                .setText(text)
                .setPageNum(pageNum)
                .setY(y)
                .setHeight(height);
    }

    public JSONObject toJson() {
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("text", text);
        jsonObject.put("pageNum", pageNum);
        jsonObject.put("y", y);
        jsonObject.put("height", height);
        return jsonObject;
    }

    public static class Builder {
        private String text;
        private int pageNum;
        private float y;
        private float height;

        public Builder setText(String text) {
            this.text = text;
            return this;
        }

        public Builder setPageNum(int pageNum) {
            this.pageNum = pageNum;
            return this;
        }

        public Builder setY(float y) {
            this.y = y;
            return this;
        }

        public Builder setHeight(float height) {
            this.height = height;
            return this;
        }

        public Segment build() {
            return new Segment(this);
        }
    }
}
