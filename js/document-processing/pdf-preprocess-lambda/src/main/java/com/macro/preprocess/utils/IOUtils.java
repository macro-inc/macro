package com.macro.preprocess.utils;

import com.macro.preprocess.nlp.constants.StringConst;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.tukaani.xz.LZMA2Options;
import org.tukaani.xz.XZInputStream;
import org.tukaani.xz.XZOutputStream;

import java.io.*;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class IOUtils {
    private static final Logger LOG = LoggerFactory.getLogger(IOUtils.class);

    private IOUtils() {
    }

    public static Object fromByteArray(byte[] array) {
        ByteArrayInputStream bin = new ByteArrayInputStream(array);
        Object obj = null;

        try {
            ObjectInputStream in = new ObjectInputStream(new BufferedInputStream(bin));
            obj = in.readObject();
            in.close();
        } catch (Exception var4) {
            var4.printStackTrace();
        }

        return obj;
    }

    public static byte[] toByteArray(Object obj) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();

        try {
            ObjectOutputStream out = new ObjectOutputStream(new BufferedOutputStream(bos));
            out.writeObject(obj);
            out.close();
        } catch (IOException var3) {
            var3.printStackTrace();
        }

        return bos.toByteArray();
    }

    public static Map<String, byte[]> toByteMap(ZipInputStream stream) throws IOException {
        Map<String, byte[]> map = new HashMap();

        ZipEntry zEntry;
        while((zEntry = stream.getNextEntry()) != null) {
            map.put(zEntry.getName(), toByteArray(stream));
        }

        stream.close();
        return map;
    }

    public static byte[] toByteArray(ZipInputStream in) throws IOException {
        ByteArrayOutputStream bout = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];

        int count;
        while((count = in.read(buffer)) != -1) {
            bout.write(buffer, 0, count);
        }

        return bout.toByteArray();
    }

    public static BufferedReader createBufferedReader(InputStream in) {
        return new BufferedReader(new InputStreamReader(in));
    }

    public static BufferedReader createBufferedReader(File file) {
        try {
            return new BufferedReader(new InputStreamReader(new FileInputStream(file)));
        } catch (FileNotFoundException var2) {
            var2.printStackTrace();
            return null;
        }
    }

    public static BufferedReader createBufferedReader(String filename) {
        return createBufferedReader((InputStream)createFileInputStream(filename));
    }

    public static PrintStream createBufferedPrintStream(OutputStream out) {
        return new PrintStream(new BufferedOutputStream(out));
    }

    public static PrintStream createBufferedPrintStream(String filename) {
        return createBufferedPrintStream((OutputStream)createFileOutputStream(filename));
    }

    public static FileInputStream createFileInputStream(String filename) {
        FileInputStream in = null;

        try {
            in = new FileInputStream(filename);
        } catch (FileNotFoundException var3) {
            var3.printStackTrace();
        }

        return in;
    }

    public static FileInputStream[] createFileInputStreams(String[] filelist) {
        int len = filelist.length;
        FileInputStream[] in = new FileInputStream[len];

        for(int i = 0; i < len; ++i) {
            in[i] = createFileInputStream(filelist[i]);
        }

        return in;
    }

    public static FileOutputStream createFileOutputStream(String filename) {
        FileOutputStream out = null;

        try {
            out = new FileOutputStream(filename);
        } catch (FileNotFoundException var3) {
            var3.printStackTrace();
        }

        return out;
    }

    public static XZOutputStream createXZBufferedOutputStream(String filename) {
        return createXZBufferedOutputStream((String)filename, 6);
    }

    public static XZOutputStream createXZBufferedOutputStream(String filename, int preset) {
        XZOutputStream zout = null;

        try {
            zout = new XZOutputStream(new BufferedOutputStream(new FileOutputStream(filename)), new LZMA2Options(preset));
        } catch (IOException var4) {
            var4.printStackTrace();
        }

        return zout;
    }

    public static XZOutputStream createXZBufferedOutputStream(OutputStream out) {
        return createXZBufferedOutputStream((OutputStream)out, 6);
    }

    public static XZOutputStream createXZBufferedOutputStream(OutputStream out, int preset) {
        XZOutputStream zout = null;

        try {
            zout = new XZOutputStream(new BufferedOutputStream(out), new LZMA2Options(preset));
        } catch (IOException var4) {
            var4.printStackTrace();
        }

        return zout;
    }

    public static XZInputStream createXZBufferedInputStream(InputStream in) {
        XZInputStream zin = null;

        try {
            zin = new XZInputStream(new BufferedInputStream(in));
        } catch (IOException var3) {
            var3.printStackTrace();
        }

        return zin;
    }

    public static XZInputStream createXZBufferedInputStream(String filename) {
        XZInputStream zin = null;

        try {
            zin = new XZInputStream(new BufferedInputStream(new FileInputStream(filename)));
        } catch (IOException var3) {
            var3.printStackTrace();
        }

        return zin;
    }

    public static ObjectInputStream createObjectXZBufferedInputStream(String filename) {
        ObjectInputStream oin = null;

        try {
            oin = new ObjectInputStream(createXZBufferedInputStream(filename));
        } catch (IOException var3) {
            var3.printStackTrace();
        }

        return oin;
    }

    public static ObjectInputStream createObjectXZBufferedInputStream(InputStream in) {
        ObjectInputStream oin = null;

        try {
            oin = new ObjectInputStream(createXZBufferedInputStream(in));
        } catch (IOException var3) {
            var3.printStackTrace();
        }

        return oin;
    }

    public static ObjectOutputStream createObjectXZBufferedOutputStream(String filename) {
        return createObjectXZBufferedOutputStream((String)filename, 6);
    }

    public static ObjectOutputStream createObjectXZBufferedOutputStream(String filename, int preset) {
        ObjectOutputStream out = null;

        try {
            out = new ObjectOutputStream(createXZBufferedOutputStream(filename, preset));
        } catch (IOException var4) {
            var4.printStackTrace();
        }

        return out;
    }

    public static ObjectOutputStream createObjectXZBufferedOutputStream(OutputStream out) {
        return createObjectXZBufferedOutputStream((OutputStream)out, 6);
    }

    public static ObjectOutputStream createObjectXZBufferedOutputStream(OutputStream out, int preset) {
        ObjectOutputStream oout = null;

        try {
            oout = new ObjectOutputStream(createXZBufferedOutputStream(out, preset));
        } catch (IOException var4) {
            var4.printStackTrace();
        }

        return oout;
    }

    public static ByteArrayInputStream createByteArrayInputStream(String s) {
        return new ByteArrayInputStream(s.getBytes());
    }

    public static InputStream getInputStreamsFromResource(String path) {
        return IOUtils.class.getResourceAsStream(StringConst.FW_SLASH + path);
    }

    public static InputStream getInputStream(String path) {
        InputStream in = getInputStreamsFromResource(path);
        return (InputStream)(in != null ? in : createFileInputStream(path));
    }

    public static InputStream createArtifactInputStream(String pathname) throws IOException {
        InputStream baseStream = null;
        if (pathname.contains(":")) {
            try {
                Path path = Paths.get(new URI(pathname));
                baseStream = Files.newInputStream(path, StandardOpenOption.READ);
            } catch (URISyntaxException var4) {
                LOG.debug("Failed to treat {} as a URI/path, falling back.", pathname);
            }
        }

        if (baseStream == null) {
            baseStream = Thread.currentThread().getContextClassLoader().getResourceAsStream(pathname);
            if (baseStream == null) {
                LOG.debug("{} not found in classpath, falling back to file system.", pathname);
                baseStream = Files.newInputStream(Paths.get(pathname));
            }
        }

        return wrapStream(baseStream, pathname);
    }

    public static InputStream createArtifactInputStream(Path path) throws IOException {
        String name = path.getFileName().toString();
        InputStream baseStream = Files.newInputStream(path, StandardOpenOption.READ);
        return wrapStream(baseStream, name);
    }

    private static InputStream wrapStream(InputStream bStream, String filename) throws IOException {
        InputStream baseStream = new BufferedInputStream(bStream);
        if (filename.endsWith(".xz")) {
            baseStream = new XZInputStream((InputStream)baseStream);
        } else if (filename.endsWith(".gz")) {
            baseStream = new GZIPInputStream((InputStream)baseStream);
        }

        return (InputStream)baseStream;
    }

    public static ObjectInputStream createArtifactObjectInputStream(String pathname) throws IOException {
        return new ObjectInputStream(createArtifactInputStream(pathname));
    }
}
