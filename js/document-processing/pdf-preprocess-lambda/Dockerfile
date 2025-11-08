FROM maven:3.8.5-openjdk-17 AS build

WORKDIR /app

# Being explicit with COPY allows for much much better dependency caching
COPY pom.xml pom.xml

# Install jar dependencies
COPY installJars.sh installJars.sh
COPY ./jars /app/jars
RUN chmod +x ./installJars.sh
RUN ./installJars.sh

COPY ./src /app/src

# Build the JAR file using Maven
RUN mvn install -DskipTests
RUN mvn compile dependency:copy-dependencies -DincludeScope=runtime -DskipTests=true

FROM public.ecr.aws/lambda/java:21

RUN dnf install -y wget xorg-x11-font-utils cabextract fontconfig

# Download and install the mscorefonts
RUN wget https://downloads.sourceforge.net/project/mscorefonts2/rpms/msttcore-fonts-installer-2.6-1.noarch.rpm
RUN rpm -i msttcore-fonts-installer-2.6-1.noarch.rpm

# Clean up
RUN dnf clean all && rm -f msttcore-fonts-installer-2.6-1.noarch.rpm

# Refresh the font cache
RUN fc-cache -f -v

# Copy function code and runtime dependencies from Maven layout
COPY --from=build /app/target/classes ${LAMBDA_TASK_ROOT}
COPY --from=build /app/target/dependency/* ${LAMBDA_TASK_ROOT}/lib/

# Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ "com.macro.preprocess.App::handleRequest" ]
