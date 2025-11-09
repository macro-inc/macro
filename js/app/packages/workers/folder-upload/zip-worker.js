import JSZip from 'jszip';

self.onmessage = function (event) {
  const { taskId, action, files, fileDetails } = event.data;

  if (action === 'zipFiles') {
    self.postMessage({
      taskId,
      type: 'progress',
      data: {
        message: `Starting to process ${files.length} files...`,
      },
    });

    zipFiles(taskId, files, fileDetails);
  }
};

async function zipFiles(taskId, files, fileDetails) {
  try {
    const zip = new JSZip();
    const totalFiles = files.length;
    let processedFiles = 0;

    // Use a timestamp for the zip filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tempZipFilename = `archive-${timestamp}.zip`;

    // Process files in batches for better performance
    const BATCH_SIZE = 50;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const batchDetails = fileDetails.slice(i, i + BATCH_SIZE);

      // Process batch
      for (let j = 0; j < batch.length; j++) {
        const file = batch[j];
        const details = batchDetails[j];
        const path = details.path;

        zip.file(path, file);

        // Update progress
        processedFiles++;
        if (processedFiles % 20 === 0 || processedFiles === totalFiles) {
          const percentage = Math.floor((processedFiles / totalFiles) * 50); // First 50% for adding files
          self.postMessage({
            taskId,
            type: 'progress',
            data: {
              percentage,
              message: `Adding files to zip: ${processedFiles}/${totalFiles}`,
            },
          });
        }
      }

      // Small delay to let other tasks run
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Generate the zip file with progress tracking
    self.postMessage({
      taskId,
      type: 'progress',
      data: {
        percentage: 50,
        message: 'Generating zip file...',
      },
    });

    const zipBlob = await zip.generateAsync(
      {
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      },
      (metadata) => {
        const percentage = 50 + Math.floor(metadata.percent / 2); // Last 50% for generation
        self.postMessage({
          taskId,
          type: 'progress',
          data: {
            percentage,
            message: `Compressing: ${metadata.percent.toFixed(1)}%`,
          },
        });
      }
    );

    // Send the completed zip back to the main thread
    self.postMessage({
      taskId,
      type: 'complete',
      data: {
        zipBlob,
        tempFilename: tempZipFilename,
      },
    });
  } catch (error) {
    console.error('ZipWorker: Error in zipFiles:', error);
    self.postMessage({
      taskId,
      type: 'error',
      data: {
        message: error.message,
      },
    });
  }
}
