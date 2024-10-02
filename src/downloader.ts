// downloader.ts
import Downloader from 'nodejs-file-downloader';
import path from 'path';
import { Logger, Quester } from 'koishi';
import { extractTarGz, extractZip } from './helper';

export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

export async function handleFile(
  nodeDir: string,
  nodeName: string,
  logger: Logger,
  http: Quester,
) {
  const url = `https://registry.npmmirror.com/@napi-rs/${nodeName.replace(
    'skia.',
    'canvas-',
  )}/v0.1.53`;

  let tarballUrl: string | undefined;

  try {
    const res = await http.get(url);
    tarballUrl = res.dist.tarball;
    logger.info(`Stating download from ${tarballUrl}`);
  } catch (e) {
    logger.error(`Failed to fetch from URL: ${url}`, e);
    throw new DownloadError(`Failed to fetch from URL: ${e.message}`);
  }

  if (!tarballUrl)
    throw new DownloadError(`Failed to get the binary url from ${url}`);

  const downloader = new Downloader({
    url: tarballUrl,
    directory: nodeDir,
    skipExistingFileName: true,
    onProgress: function (percentage, _chunk, remainingSize) {
      //Gets called with each chunk.
      logger.info(
        `${percentage} % Remaining(MB): ${remainingSize / 1024 / 1024}`,
      );
    },
  });

  const { filePath, downloadStatus } = await downloader.download();
  if (downloadStatus !== 'COMPLETE')
    throw new DownloadError('Download was aborted');
  await extractTarGz(path.resolve(filePath));
  logger.success(`File downloaded successfully at ${filePath}`);
}

export async function downloadFonts(
  fontDir: string,
  fontUrl: string,
  logger: Logger,
) {
  const downloadFontTask = new Downloader({
    url: fontUrl,
    directory: fontDir,
    // Avoid download when exist
    skipExistingFileName: true,
    onProgress: function (percentage, _chunk, remainingSize) {
      //Gets called with each chunk.
      logger.info(
        `Font Downloader: ${percentage} % Remaining(MB): ${
          remainingSize / 1024 / 1024
        }`,
      );
    },
  });

  const { filePath, downloadStatus } = await downloadFontTask.download();
  if (downloadStatus !== 'COMPLETE')
    throw new DownloadError('Download was aborted');
  if (filePath.endsWith('tar.gz') || filePath.endsWith('tgz')) {
    await extractTarGz(path.resolve(filePath));
  }
  if (filePath.endsWith('.zip')) {
    await extractZip(path.resolve(filePath));
  }
  logger.success(`File downloaded successfully at ${filePath}`);
}
