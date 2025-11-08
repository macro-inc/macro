#!/bin/sh

echo "Installing Jars"

echo "batik"
mvn install:install-file -Dfile="jars/batik-all-1.11.jar" -DgroupId=batik -DartifactId=batik -Dversion="1.11" -Dpackaging=jar

echo "fontbox"
mvn install:install-file -Dfile="jars/fontbox-3.0.0-SNAPSHOT.jar" -DgroupId=fontbox -DartifactId=fontbox -Dversion="3.0.0" -Dpackaging=jar

echo "pdfbox"
mvn install:install-file -Dfile="jars/pdfbox-3.0.0-SNAPSHOT.jar" -DgroupId=pdfbox -DartifactId=pdfbox -Dversion="3.0.0" -Dpackaging=jar

echo "sfntly"
mvn install:install-file -Dfile="jars/sfntly-javadoc.jar" -DgroupId=sfntly -DartifactId=sfntly -Dversion="1.0" -Dpackaging=jar

echo "FontVerter"
mvn install:install-file -Dfile="jars/FontVerter-1.2.22.jar" -DgroupId=FontVerter -DartifactId=FontVerter -Dversion="1.2.22" -Dpackaging=jar
