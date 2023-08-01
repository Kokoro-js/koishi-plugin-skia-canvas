import { Context, Logger, Schema, Service } from 'koishi';
import path from 'path';
import { mkdir } from 'fs/promises';
import fs from 'fs';
import tar from 'tar';
import zlib from 'zlib';
import Downloader from 'nodejs-file-downloader';
import type {
  FillType,
  Canvas as NativeCanvas,
  Path2D,
  ImageData,
  PathOp,
  StrokeCap,
  StrokeJoin,
  SvgExportFlag,
  SvgCanvas,
  Image,
  LoadImageOptions,
  IGlobalFonts,
  DOMRect,
  DOMMatrix,
  DOMPoint,
} from '@ahdg/canvas';

export const name = 'canvas';
const logger = new Logger(name);

declare module 'koishi' {
  interface Context {
    canvas: Canvas;
  }
}
export class Canvas extends Service {
  createCanvas: {
    (width: number, height: number): NativeCanvas;
    (width: number, height: number, svgExportFlag: SvgExportFlag): SvgCanvas;
  };
  clearAllCache: () => void;
  convertSVGTextToPath: (svg: Buffer | string) => Buffer;
  loadImage: (
    source:
      | string
      | URL
      | Buffer
      | ArrayBufferLike
      | Uint8Array
      | Image
      | import('stream').Readable,
    options?: LoadImageOptions,
  ) => Promise<Image>;

  Canvas: NativeCanvas;
  Path2D: Path2D;
  ImageData: ImageData;
  Image: Image;
  PathOp: PathOp;
  FillType: FillType;
  StrokeCap: StrokeCap;
  StrokeJoin: StrokeJoin;
  SvgExportFlag: SvgExportFlag;
  GlobalFonts: IGlobalFonts;

  DOMPoint: DOMPoint;
  DOMMatrix: DOMMatrix;
  DOMRect: DOMRect;

  constructor(
    ctx: Context,
    public config: Canvas.Config,
  ) {
    super(ctx, 'canvas');

    ctx.command('canvas').action(async () => {
      return (
        'Canvas 已加载字体：\n' +
        this.GlobalFonts.families.map((obj) => obj.family).join(', ')
      );
    });
  }

  async start() {
    let { nodeBinaryPath, fontPath } = this.config;
    const nodeDir = path.resolve(this.ctx.baseDir, nodeBinaryPath);
    const fontDir = path.resolve(this.ctx.baseDir, fontPath);
    await mkdir(nodeDir, { recursive: true });
    await mkdir(fontDir, { recursive: true });
    let nativeBinding: any;
    try {
      nativeBinding = await getNativeBinding(nodeDir);
    } catch (e) {
      if (e instanceof UnsupportedError) {
        logger.error('Canvas 目前不支持你的系统');
      }
      if (e instanceof DownloadError) {
        logger.error('下载二进制文件遇到错误，请查看日志获取更详细信息');
      }
      throw e;
    }
    ({
      clearAllCache: this.clearAllCache,
      Canvas: this.Canvas,
      createCanvas: this.createCanvas,
      Path2D: this.Path2D,
      ImageData: this.ImageData,
      Image: this.Image,
      PathOp: this.PathOp,
      FillType: this.FillType,
      StrokeCap: this.StrokeCap,
      StrokeJoin: this.StrokeJoin,
      SvgExportFlag: this.SvgExportFlag,
      GlobalFonts: this.GlobalFonts,
      convertSVGTextToPath: this.convertSVGTextToPath,
      DOMPoint: this.DOMPoint,
      DOMMatrix: this.DOMMatrix,
      DOMRect: this.DOMRect,
      loadImage: this.loadImage,
    } = nativeBinding);

    logger.success('Canvas 加载成功');

    await new Downloader({
      url: 'http://file.tartaros.fun/files/64c8ed3d59f04/LXGWWenKaiLite-Regular.ttf',
      directory: fontDir,
      skipExistingFileName: true,
      onProgress: function (percentage, _chunk, remainingSize) {
        //Gets called with each chunk.
        logger.info(
          `LXGW: ${percentage} % Remaining(MB): ${remainingSize / 1024 / 1024}`,
        );
      },
    }).download();
    logger.success(
      `已加载来自目录 ${fontDir} 的 ${this.GlobalFonts.loadFontsFromDir(
        fontDir,
      )} 个字体`,
    );
  }
}

function isMusl() {
  // For Node 10
  if (!process.report || typeof process.report.getReport !== 'function') {
    try {
      const lddPath = require('child_process')
        .execSync('which ldd')
        .toString()
        .trim();
      return fs.readFileSync(lddPath, 'utf8').includes('musl');
    } catch (e) {
      return true;
    }
  } else {
    const report: { header: any } = process.report.getReport() as unknown as {
      header: any;
    };
    const glibcVersionRuntime = report.header?.glibcVersionRuntime;
    return !glibcVersionRuntime;
  }
}

async function getNativeBinding(nodeDir) {
  const { platform, arch } = process;
  let nativeBinding;
  let nodeName;
  switch (platform) {
    case 'android':
      switch (arch) {
        case 'arm64':
          nodeName = 'skia.android-arm64';
          break;
        case 'arm':
          nodeName = 'skia.android-arm-eabi';
          break;
        default:
          throw new UnsupportedError(
            `Unsupported architecture on Android ${arch}`,
          );
      }
      break;
    case 'win32':
      switch (arch) {
        case 'x64':
          nodeName = 'skia.win32-x64-msvc';
          break;
        case 'ia32':
          nodeName = 'skia.win32-ia32-msvc';
          break;
        case 'arm64':
          nodeName = 'skia.win32-arm64-msvc';
          break;
        default:
          throw new UnsupportedError(
            `Unsupported architecture on Windows: ${arch}`,
          );
      }
      break;
    case 'darwin':
      switch (arch) {
        case 'x64':
          nodeName = 'skia.darwin-x64';
          break;
        case 'arm64':
          nodeName = 'skia.darwin-arm64';
          break;
        default:
          throw new UnsupportedError(
            `Unsupported architecture on macOS: ${arch}`,
          );
      }
      break;
    case 'freebsd':
      if (arch !== 'x64') {
        throw new UnsupportedError(
          `Unsupported architecture on FreeBSD: ${arch}`,
        );
      }
      nodeName = 'skia.freebsd-x64';
      break;
    case 'linux':
      switch (arch) {
        case 'x64':
          if (isMusl()) {
            nodeName = 'skia.linux-x64-musl';
          } else {
            nodeName = 'skia.linux-x64-gnu';
          }
          break;
        case 'arm64':
          if (isMusl()) {
            nodeName = 'skia.linux-arm64-musl';
          } else {
            nodeName = 'skia.linux-arm64-gnu';
          }
          break;
        case 'arm':
          nodeName = 'skia.linux-arm-gnueabihf';
          break;
        default:
          throw new UnsupportedError(
            `Unsupported architecture on Linux: ${arch}`,
          );
      }
      break;
    default:
      throw new UnsupportedError(
        `Unsupported OS: ${platform}, architecture: ${arch}`,
      );
  }
  const nodeFile = nodeName + '.node';
  const nodePath = path.join(nodeDir, 'package', nodeFile);
  const localFileExisted = fs.existsSync(nodePath);
  global.GLOBAL_NATIVE_BINDING_PATH = nodePath;
  try {
    if (!localFileExisted) await handleFile(nodeDir, nodeName);
    nativeBinding = require('@ahdg/canvas');
  } catch (e) {
    logger.error('An error was encountered while processing the binary', e);
    if (e instanceof DownloadError) {
      throw e;
    }
    throw new Error(`Failed to use ${nodePath} on ${platform}-${arch}`);
  }
  return nativeBinding;
}

async function handleFile(nodeDir: string, nodeName: string) {
  const url = `https://registry.npmjs.org/@napi-rs/${nodeName.replace(
    'skia.',
    'canvas-',
  )}/latest`;
  let data;
  try {
    const response = await fetch(url);
    data = await response.json();
  } catch (e) {
    logger.error(`Failed to fetch from URL: ${url}`, e);
    throw new DownloadError(`Failed to fetch from URL: ${e.message}`);
  }
  const tarballUrl = data.dist.tarball;
  if (!tarballUrl) throw new DownloadError('Failed to get File url');

  const downloader = new Downloader({
    url: tarballUrl,
    directory: nodeDir,
    onProgress: function (percentage, _chunk, remainingSize) {
      //Gets called with each chunk.
      logger.info(
        `${percentage} % Remaining(MB): ${remainingSize / 1024 / 1024}`,
      );
    },
  });
  logger.info('Start downloading the Canvas binaries');
  try {
    const { filePath, downloadStatus } = await downloader.download();
    if (downloadStatus === 'COMPLETE') {
      await extract(path.resolve(filePath));
      logger.success(`File downloaded successfully at ${filePath}`);
    } else {
      throw new DownloadError('Download was aborted');
    }
  } catch (e) {
    logger.error('Failed to download the file', e);
    throw new DownloadError(`Failed to download the binary file: ${e.message}`);
  }
}

const extract = async (filePath: string) => {
  const outputDir = path.dirname(filePath);
  const readStream = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  const extractStream = tar.extract({ cwd: outputDir });
  readStream.pipe(gunzip).pipe(extractStream);
  return new Promise<void>((resolve, reject) => {
    extractStream.on('finish', resolve);
    extractStream.on('error', reject);
  });
};

export namespace Canvas {
  export interface Config {
    nodeBinaryPath: string;
    fontPath: string;
  }
  export const Config = Schema.intersect([
    Schema.object({
      nodeBinaryPath: Schema.path({
        filters: ['directory'],
        allowCreate: true,
      })
        .description('Canvas binary file storage directory')
        .default('node-rs/canvas'),
      fontPath: Schema.path({
        filters: ['directory'],
        allowCreate: true,
      })
        .description('Canvas custom font storage directory')
        .default('node-rs/canvas/font'),
    }).i18n({
      zh: {
        nodeBinaryPath: 'Canvas 自定义字体存放目录',
        fontPath: 'Canvas 自定义字体存放目录',
      },
    }),
  ]) as Schema<Config>;
}

Context.service('canvas', Canvas);
export default Canvas;

class DownloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DownloadError';
  }
}
class UnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedError';
  }
}
