package com.macro.preprocess.component.logical.ai;

import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Metadata for a page in a document
 */
public class PageData {
    private int pageNum;
    private float pageHeight;
    private List<TextBoxData> textBoxDatas;

    private PageData(Builder builder) {
        this.pageNum = builder.pageNum;
        this.pageHeight = builder.pageHeight;
        this.textBoxDatas = builder.textBoxDatas;
    }

    /**
     * @return the page number of the page (0-indexed)
     */
    public int getPageNum() {
        return pageNum;
    }

    /**
     * @return the height of the page via the page's bounding box: {@link org.apache.pdfbox.pdmodel.PDPage#getBBox}
     */
    public float getPageHeight() {
        return pageHeight;
    }

    /**
     * @return the list of text box metadata which make up the page
     */
    public List<TextBoxData> getTextBoxDatas() {
        return textBoxDatas;
    }

    public Builder toBuilder() {
        return new Builder()
                .setPageNum(pageNum)
                .setPageHeight(pageHeight)
                .setTextBoxDatas(textBoxDatas);
    }

    public JSONObject toJson() {
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("pageNum", pageNum);
        jsonObject.put("pageHeight", pageHeight);
        JSONArray textBoxDatasJson = new JSONArray();
        for (TextBoxData textBoxData : textBoxDatas) {
            textBoxDatasJson.put(textBoxData.toJson());
        }
        jsonObject.put("textBoxDatas", textBoxDatasJson);
        return jsonObject;
    }

    public static PageData fromJson(JSONObject jsonObject) {
        Builder builder = new Builder();
        builder.setPageNum(jsonObject.getInt("pageNum"));
        builder.setPageHeight(jsonObject.getFloat("pageHeight"));
        JSONArray textBoxDatasJson = jsonObject.getJSONArray("textBoxDatas");
        for (int i = 0; i < textBoxDatasJson.length(); i++) {
            builder.addTextBoxData(TextBoxData.fromJson(textBoxDatasJson.getJSONObject(i)));
        }
        return builder.build();
    }


    public static class Builder {
        private int pageNum;
        private float pageHeight;
        private List<TextBoxData> textBoxDatas = new java.util.ArrayList<>();

        public Builder setPageNum(int pageNum) {
            this.pageNum = pageNum;
            return this;
        }

        public Builder setPageHeight(float pageHeight) {
            this.pageHeight = pageHeight;
            return this;
        }

        public Builder setTextBoxDatas(List<TextBoxData> textBoxDatas) {
            this.textBoxDatas = textBoxDatas;
            return this;
        }

        public Builder addTextBoxData(TextBoxData textBoxData) {
            this.textBoxDatas.add(textBoxData);
            return this;
        }


        public PageData build() {
            return new PageData(this);
        }
    }
}