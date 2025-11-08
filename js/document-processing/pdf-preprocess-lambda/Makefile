.PHONY: build
build:
	mvn clean install -DskipTests=true
	mvn compile dependency:copy-dependencies -DincludeScope=runtime -DskipTests=true
