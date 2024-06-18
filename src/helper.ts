import * as fs from "fs";
import * as path from "path";
import { gunzipSync, unzipSync } from "fflate";
import tar from "tar-stream";

/**
 * Extracts a .tar.gz file to the directory of the file.
 *
 * @param {string} filePath - The path of the .tar.gz file.
 * @returns {Promise<void>} A promise that resolves when the extraction is complete, or rejects if an error occurs.
 */
export const extractTarGz = async (filePath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const outputDir = path.dirname(filePath);

    // Read the .tar.gz file
    const fileBuffer = fs.readFileSync(filePath);

    // Decompress the .tar.gz file
    const decompressedBuffer = gunzipSync(fileBuffer);

    // Extract the TAR archive
    const extract = tar.extract();
    extract.on("entry", (header, stream, next) => {
      const outputPath = path.join(outputDir, header.name);
      if (header.type === "directory") {
        fs.mkdirSync(outputPath, { recursive: true });
        stream.on("end", next);
        stream.resume();
      } else if (header.type === "file") {
        stream.pipe(fs.createWriteStream(outputPath));
        stream.on("end", next);
      } else {
        stream.on("end", next);
        stream.resume(); // handle other types (like symlinks) by ignoring the content
      }
    });

    extract.on("finish", () => {
      console.log(`Successfully extracted .tar.gz file to ${outputDir}`);
      resolve();
    });

    extract.on("error", reject);

    // Feed the decompressed buffer into tar-stream
    extract.end(decompressedBuffer);
  });
};

/**
 * Extracts a .zip file to the directory of the file.
 *
 * @param {string} filePath - The path of the .zip file.
 * @returns {Promise<void>} A promise that resolves when the extraction is complete, or rejects if an error occurs.
 */
export const extractZip = async (filePath: string): Promise<void> => {
  const outputDir = path.dirname(filePath);

  // Read and decompress the .zip file
  const fileBuffer = fs.readFileSync(filePath);
  const unzipped = unzipSync(fileBuffer);

  // Extract the .zip file
  for (const [fileName, file] of Object.entries(unzipped)) {
    const outputPath = path.join(outputDir, fileName);
    if (fileName.endsWith("/")) {
      fs.mkdirSync(outputPath, { recursive: true });
    } else {
      fs.writeFileSync(outputPath, Buffer.from(file));
    }
  }

  console.log(`Successfully extracted .zip file to ${outputDir}`);
};
