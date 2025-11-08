package com.macro.preprocess.parse;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class PageInfoCache {
    Map<Integer, Float> pageHeightCache;
    Map<Integer, Float> pageWidthCache;
    Map<Integer, PDPage> documentPageCache;
    PDDocument document;

    public PageInfoCache(PDDocument document) {
        this.pageHeightCache = new ConcurrentHashMap<>();
        this.pageWidthCache = new ConcurrentHashMap<>();
        this.documentPageCache = new ConcurrentHashMap<>();
        this.document = document;
    }

    public float getPageHeight(int pageNum) {
        if (!this.pageHeightCache.containsKey(pageNum)) {
            float height = this.getPage(pageNum).getBBox().getHeight();
            this.setPageHeight(pageNum, height);
        }
        return this.pageHeightCache.get(pageNum);
    }

    public void setPageHeight(int pageNum, float height) {
        this.pageHeightCache.put(pageNum, height);
    }

    public float getPageWidth(int pageNum) {
        if (!this.pageWidthCache.containsKey(pageNum)) {
            float width = this.getPage(pageNum).getBBox().getWidth();
            this.setPageWidth(pageNum, width);
        }
        return this.pageWidthCache.get(pageNum);
    }

    public void setPageWidth(int pageNum, float width) {
        this.pageWidthCache.put(pageNum, width);
    }

    public PDPage getPage(int pageNum) {
        if (!this.documentPageCache.containsKey(pageNum)) {
            this.setPage(pageNum, this.document.getPage(pageNum));
        }
        return this.documentPageCache.get(pageNum);
    }

    public void setPage(int pageNum, PDPage pdPage) {
        this.documentPageCache.put(pageNum, pdPage);
    }



}
