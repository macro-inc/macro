package com.macro.preprocess;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public class DatabaseUtils {
  private static final String JDBC_PREFIX = "jdbc:";

  /**
   * @return connection to database
   * @throws SQLException
   */
  public static Connection databaseConnection() throws SQLException {
    // Ensures that the postgres driver is in the lambda
    try {
      Class.forName("org.postgresql.Driver");
    } catch (ClassNotFoundException e) {
      e.printStackTrace();
    }
    String databaseUrl = System.getenv("DATABASE_URL");
    String databaseUser = System.getenv("DATABASE_USER");
    String databasePassword = System.getenv("DATABASE_PASSWORD");
    return DriverManager.getConnection(JDBC_PREFIX + databaseUrl, databaseUser, databasePassword);
  }

  public static String getJobIdFromUploadJob(Connection databaseConnection, String documentId) throws SQLException {
    String jobId = null;
    String getJobIdFromUploadJobQuery = "SELECT \"jobId\" FROM \"UploadJob\" WHERE \"documentId\" = ? AND \"jobType\" = 'pdf_preprocess'";
    PreparedStatement getJobIdFromUploadJobStmt = databaseConnection.prepareStatement(getJobIdFromUploadJobQuery);
    getJobIdFromUploadJobStmt.setString(1, documentId);
    ResultSet resultSet = getJobIdFromUploadJobStmt.executeQuery();
    if (resultSet.next()) {
      jobId = resultSet.getString("jobId");
    }
    resultSet.close();
    getJobIdFromUploadJobStmt.close();
    return jobId;
  }

  public static int insertDocumentProcessResult(Connection databaseConnection, String documentId, String parseResponse,
      final Logger logger)
      throws SQLException {
    String jobType = "pdf_preprocess";
    String insertDocumentProcessResultQuery = "INSERT INTO \"DocumentProcessResult\" (\"documentId\", \"jobType\", content) VALUES (?, ?, ?) RETURNING id";

    PreparedStatement insertDocumentProcessResultStmt = null;
    ResultSet resultSet = null;
    int documentProcessResultId = -1;
    try {
      insertDocumentProcessResultStmt = databaseConnection
          .prepareStatement(insertDocumentProcessResultQuery);
      insertDocumentProcessResultStmt.setString(1, documentId);
      insertDocumentProcessResultStmt.setString(2, jobType);
      insertDocumentProcessResultStmt.setString(3, parseResponse);

      resultSet = insertDocumentProcessResultStmt.executeQuery();

      if (resultSet.next()) {
        documentProcessResultId = resultSet.getInt("id");
      }
      resultSet.close();
      insertDocumentProcessResultStmt.close();
    } catch (SQLException e) {
      if (e.getMessage().contains("duplicate key value violates unique constraint ")) {
        PreparedStatement getDocumentProcessResultIdStmt = databaseConnection
            .prepareStatement("SELECT id FROM \"DocumentProcessResult\" WHERE \"documentId\" = ? AND \"jobType\" = ?");
        getDocumentProcessResultIdStmt.setString(1, documentId);
        getDocumentProcessResultIdStmt.setString(2, jobType);
        ResultSet getDocumentProcessResultId = getDocumentProcessResultIdStmt.executeQuery();

        if (getDocumentProcessResultId.next()) {
          documentProcessResultId = getDocumentProcessResultId.getInt("id");
        }

        getDocumentProcessResultId.close();
        getDocumentProcessResultIdStmt.close();

      } else {
        logger.error("unable to insert document process result " + e.getMessage());
      }
    } finally {
      if (resultSet != null) {
        resultSet.close();
      }
      if (insertDocumentProcessResultStmt != null) {
        insertDocumentProcessResultStmt.close();
      }
    }

    return documentProcessResultId;
  }

  public static int insertJobToDocumentProcessResult(Connection databaseConnection, String jobId,
      int documentProcessResultId)
      throws SQLException {
    String insertJobToDocumentProcessResultQuery = "INSERT INTO \"JobToDocumentProcessResult\" (\"jobId\", \"documentProcessResultId\") VALUES (?, ?)";

    PreparedStatement insertJobToDocumentProcessResultStmt = databaseConnection
        .prepareStatement(insertJobToDocumentProcessResultQuery);
    insertJobToDocumentProcessResultStmt.setString(1, jobId);
    insertJobToDocumentProcessResultStmt.setInt(2, documentProcessResultId);

    int result = insertJobToDocumentProcessResultStmt.executeUpdate();

    insertJobToDocumentProcessResultStmt.close();

    return result;
  }
}
