package com.macro.preprocess.models;

import java.io.IOException;

import org.apache.pdfbox.pdmodel.PDPage;

public class PositionNormalizer {
    public static float normalizeX(PDPage page, float xPct) throws IOException {
        return getXOffset(page) + (page.getTrimBox().getWidth() * xPct);
    }

    public static float normalizeY(PDPage page, float yPct) throws IOException {
        return getYOffset(page) + (page.getTrimBox().getHeight() * (1 - yPct));
    }

    public static float getXOffset(PDPage page) throws IOException {
        return page.getMediaBox().getLowerLeftX() +
                (page.getTrimBox().getLowerLeftX() - page.getMediaBox().getLowerLeftX());
    }

    public static float getYOffset(PDPage page) throws IOException {
        return page.getMediaBox().getLowerLeftY() +
                (page.getTrimBox().getLowerLeftY() - page.getMediaBox().getLowerLeftY());
    }

}
