import { Context, Logger, Schema, Service } from 'koishi';
import path from 'path';
import { mkdir } from 'fs/promises';
import fs from 'fs';
import { handleFile, DownloadError, downloadFonts } from './downloader';
import type {
  Canvas as NativeCanvas,
  Path2D,
  ImageData,
  SvgCanvas,
  Image,
  LoadImageOptions,
  IGlobalFonts,
  DOMRect,
  DOMMatrix,
  DOMPoint,
} from '@ahdg/canvas';

import * as url from 'url';

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
  GlobalFonts: IGlobalFonts;

  DOMPoint: DOMPoint;
  DOMMatrix: DOMMatrix;
  DOMRect: DOMRect;

  private fontsArray: string[];
  private presetFont: string;

  getFonts() {
    return this.fontsArray;
  }

  getPresetFont() {
    return this.presetFont;
  }

  constructor(
    ctx: Context,
    public config: Canvas.Config,
  ) {
    super(ctx, 'canvas');

    ctx.i18n.define('zh', require('./locales/zh-CN'));
    ctx
      .command('canvas')
      .option('refresh', '-r')
      .action(async ({ session, options }) => {
        if (options.refresh) {
          this.fontsArray = this.GlobalFonts.families.map((obj) => obj.family);
        }
        return session.text('.loaded-fonts') + this.fontsArray.join(', ');
      });

    ctx
      .command('canvas/registerFont <fontUrl:string>', { authority: 4 })
      .action(async ({ session }, fontUrl) => {
        const fontDir = path.resolve(this.ctx.baseDir, config.fontPath);
        const parsedUrl = new url.URL(fontUrl);
        const endings = ['.otf', '.ttf', '.tgz', 'tar.gz'];
        if (!endings.some((ending) => parsedUrl.pathname.endsWith(ending))) {
          return session.text('.not-downloadable-type');
        }

        try {
          await downloadFonts(fontDir, fontUrl, logger);
          this.GlobalFonts.registerFromPath(fontDir);
          const loadedFonts = this.GlobalFonts.families.map(
            (obj) => obj.family,
          );
          this.fontsArray.unshift(loadedFonts[loadedFonts.length - 1]);
        } catch (e) {
          if (e instanceof DownloadError)
            return `${session.text('download-fail')}：${e}`;
          return `${session.text('load-fail')}：${e}`;
        }
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
      GlobalFonts: this.GlobalFonts,
      convertSVGTextToPath: this.convertSVGTextToPath,
      DOMPoint: this.DOMPoint,
      DOMMatrix: this.DOMMatrix,
      DOMRect: this.DOMRect,
      loadImage: this.loadImage,
    } = nativeBinding);

    logger.success('Canvas 加载成功');

    this.fontsArray = this.GlobalFonts.families.map((obj) => obj.family);

    this.loadExtraFonts(fontDir).catch((e) =>
      logger.error('加载额外字体遇到了错误', e),
    );
  }

  private async loadExtraFonts(fontDir: string) {
    const extraFontNum = this.GlobalFonts.loadFontsFromDir(fontDir);

    const defaultfont = 'lxgw-wenkai-lite-v1.300';
    if (!fs.existsSync(path.join(fontDir, `${defaultfont}.tar.gz`))) {
      try {
        await downloadFonts(
          fontDir,
          'http://file.tartaros.fun/files/64cb5229d636e/lxgw-wenkai-lite-v1.300.tar.gz',
          logger,
        );
      } catch (e) {
        logger.error(
          '下载预设字体遇到错误，这意味着我们无法保证在特殊系统上能渲染中文等字符。',
        );
        logger.success(
          `已加载来自目录 ${fontDir} 的 ${extraFontNum} 个字体，但我们无法为您提供预设字体 ${defaultfont}。`,
        );
        return;
      }
    }

    const defaultFontNum = this.GlobalFonts.loadFontsFromDir(
      path.join(fontDir, defaultfont),
    );

    logger.success(
      `已加载来自目录 ${fontDir} 的 ${extraFontNum} 个字体，其中预载了 ${defaultfont} 的 ${defaultFontNum} 个字体。`,
    );

    this.presetFont = 'LXGW WenKai Lite';
    // 把额外加载的字体提前
    const fonts = this.GlobalFonts.families.map((obj) => obj.family);
    this.fontsArray = fonts
      .slice(-(extraFontNum + defaultFontNum))
      .concat(fonts.slice(0, -(extraFontNum + defaultFontNum)));
  }
}

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

async function getNativeBinding(nodeDir: string) {
  const { platform, arch } = process;
  let nativeBinding: any;
  let nodeName: string;

  const platformArchMap = {
    android: {
      arm64: 'skia.android-arm64',
      arm: 'skia.android-arm-eabi',
    },
    win32: {
      x64: 'skia.win32-x64-msvc',
      ia32: 'skia.win32-ia32-msvc',
      arm64: 'skia.win32-arm64-msvc',
    },
    darwin: {
      x64: 'skia.darwin-x64',
      arm64: 'skia.darwin-arm64',
    },
    freebsd: {
      x64: 'skia.freebsd-x64',
    },
    linux: {
      x64: isMusl() ? 'skia.linux-x64-musl' : 'skia.linux-x64-gnu',
      arm64: isMusl() ? 'skia.linux-arm64-musl' : 'skia.linux-arm64-gnu',
      arm: 'skia.linux-arm-gnueabihf',
    },
  };
  if (!platformArchMap[platform]) {
    throw new UnsupportedError(
      `Unsupported OS: ${platform}, architecture: ${arch}`,
    );
  }
  if (!platformArchMap[platform][arch]) {
    throw new UnsupportedError(
      `Unsupported architecture on ${platform}: ${arch}`,
    );
  }

  nodeName = platformArchMap[platform][arch];

  const nodeFile = nodeName + '.node';
  const nodePath = path.join(nodeDir, 'package', nodeFile);
  const localFileExisted = fs.existsSync(nodePath);
  global.GLOBAL_NATIVE_BINDING_PATH = nodePath;
  try {
    if (!localFileExisted) await handleFile(nodeDir, nodeName, logger);
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

class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export enum FillType {
  Winding = 0,
  EvenOdd = 1,
  InverseWinding = 2,
  InverseEvenOdd = 3,
}

export enum StrokeJoin {
  Miter = 0,
  Round = 1,
  Bevel = 2,
}

export enum StrokeCap {
  Butt = 0,
  Round = 1,
  Square = 2,
}

export enum SvgExportFlag {
  ConvertTextToPaths = 0x01,
  NoPrettyXML = 0x02,
  RelativePathEncoding = 0x04,
}

export enum PathOp {
  Difference = 0, // subtract the op path from the first path
  Intersect = 1, // intersect the two paths
  Union = 2, // union (inclusive-or) the two paths
  Xor = 3, // exclusive-or the two paths
  ReverseDifference = 4, // subtract the first path from the op path
}

export type {
  NativeCanvas,
  Path2D,
  ImageData,
  SvgCanvas,
  Image,
  LoadImageOptions,
  IGlobalFonts,
  DOMRect,
  DOMMatrix,
  DOMPoint,
};
