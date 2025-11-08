package com.macro.preprocess.nlp.common.util;

import org.w3c.dom.*;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.InputStream;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

public class XMLUtils {
    private XMLUtils() {
    }

    public static String getPrettyPrint(Document doc) {
        try {
            TransformerFactory tf = TransformerFactory.newInstance();
            Transformer transformer = tf.newTransformer();
            transformer.setOutputProperty("omit-xml-declaration", "yes");
            StringWriter writer = new StringWriter();
            transformer.transform(new DOMSource(doc), new StreamResult(writer));
            return writer.getBuffer().toString();
        } catch (Exception var4) {
            var4.printStackTrace();
            return null;
        }
    }

    public static Element getElementByTagName(Element element, String name, int index) {
        NodeList list = element.getElementsByTagName(name);
        return (Element)list.item(index);
    }

    public static Element getFirstElementByTagName(Document document, String name) {
        return getFirstElement(document.getElementsByTagName(name));
    }

    public static Element getFirstElementByTagName(Element element, String name) {
        return getFirstElement(element.getElementsByTagName(name));
    }

    private static Element getFirstElement(NodeList list) {
        return list.getLength() > 0 ? (Element)list.item(0) : null;
    }

    public static List<Node> getAttributeNodeList(Element element, Pattern name) {
        NamedNodeMap nodes = element.getAttributes();
        List<Node> attributes = new ArrayList();
        int size = nodes.getLength();

        for(int i = 0; i < size; ++i) {
            Node node = nodes.item(i);
            if (name.matcher(node.getNodeName()).find()) {
                attributes.add(node);
            }
        }

        return attributes;
    }

    public static Element getDocumentElement(InputStream in) {
        DocumentBuilderFactory dFactory = DocumentBuilderFactory.newInstance();

        try {
            DocumentBuilder builder = dFactory.newDocumentBuilder();
            Document doc = builder.parse(in);
            return doc.getDocumentElement();
        } catch (Exception var4) {
            var4.printStackTrace();
            return null;
        }
    }

    public static List<Element> getChildElementList(Element root) {
        List<Element> list = new ArrayList();
        NodeList nodes = root.getChildNodes();
        int size = nodes.getLength();

        for(int i = 0; i < size; ++i) {
            Node node = nodes.item(i);
            if (node.getNodeType() == 1) {
                list.add((Element)node);
            }
        }

        return list;
    }

    public static String getTrimmedTextContent(Element element) {
        return element != null ? element.getTextContent().trim() : null;
    }

    public static int getIntegerTextContent(Element element) {
        String s = getTrimmedTextContent(element);
        return s != null && !s.isEmpty() ? Integer.parseInt(s) : 0;
    }

    public static float getFloatTextContent(Element element) {
        String s = getTrimmedTextContent(element);
        return s != null && !s.isEmpty() ? Float.parseFloat(s) : 0.0F;
    }

    public static double getDoubleTextContent(Element element) {
        String s = getTrimmedTextContent(element);
		if (s.contains("-")) {
			s = s.substring(s.lastIndexOf("-") + 1);
		}
        return s != null && !s.isEmpty() ? Double.parseDouble(s) : 0.0;
    }

    public static boolean getBooleanTextContent(Element element) {
        String s = getTrimmedTextContent(element);
        return s != null && !s.isEmpty() ? Boolean.parseBoolean(s) : false;
    }

    public static String getTrimmedAttribute(Element element, String name) {
        return element.getAttribute(name).trim();
    }

    public static boolean getBooleanAttribute(Element element, String name) {
        return Boolean.parseBoolean(getTrimmedAttribute(element, name));
    }

    public static int getIntegerAttribute(Element element, String name) {
        String s = getTrimmedAttribute(element, name);
        return s.isEmpty() ? 0 : Integer.parseInt(s);
    }

    public static double getDoubleAttribute(Element element, String name) {
        String s = getTrimmedAttribute(element, name);
		if (s.contains("-")) {
			s = s.substring(s.lastIndexOf("-") + 1);
		}
        return s.isEmpty() ? 0.0 : Double.parseDouble(s);
    }

    public static float getFloatAttribute(Element element, String name) {
        String s = getTrimmedAttribute(element, name);
        return s.isEmpty() ? 0.0F : Float.parseFloat(s);
    }

    public static String getTextContentFromFirstElementByTagName(Element element, String tagName) {
        return getTrimmedTextContent(getFirstElementByTagName(element, tagName));
    }

    public static double getDoubleTextContentFromFirstElementByTagName(Element element, String tagName) {
        return getDoubleTextContent(getFirstElementByTagName(element, tagName));
    }

    public static float getFloatTextContentFromFirstElementByTagName(Element element, String tagName) {
        return getFloatTextContent(getFirstElementByTagName(element, tagName));
    }

    public static int getIntegerTextContentFromFirstElementByTagName(Element element, String tagName) {
        return getIntegerTextContent(getFirstElementByTagName(element, tagName));
    }

    public static boolean getBooleanTextContentFromFirstElementByTagName(Element element, String tagName) {
        return getBooleanTextContent(getFirstElementByTagName(element, tagName));
    }
}
