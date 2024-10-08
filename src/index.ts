import { Context, h, Logger, Schema, Service } from 'koishi';
import path from 'path';
import { mkdir } from 'fs/promises';
import fs from 'fs';
import { handleFile, DownloadError, downloadFonts } from './downloader';
import type skia from '@ahdg/canvas';
export type { skia };

import * as url from 'url';

export const name = 'canvas';

declare module 'koishi' {
  interface Context {
    canvas: Canvas;
  }
}
export class Canvas extends Service {
  createCanvas: {
    (width: number, height: number): skia.Canvas;
    (
      width: number,
      height: number,
      svgExportFlag: SvgExportFlag,
    ): skia.SvgCanvas;
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
      | skia.Image
      | import('stream').Readable,
    options?: skia.LoadImageOptions,
  ) => Promise<skia.Image>;

  static cherryBox = require('cherry-box');
  Canvas!: typeof skia.Canvas;
  Path2D: typeof skia.Path2D;
  ImageData: typeof skia.ImageData;
  Image: typeof skia.Image;
  GlobalFonts: skia.IGlobalFonts;

  DOMPoint: skia.DOMPoint;
  DOMMatrix: skia.DOMMatrix;
  DOMRect: skia.DOMRect;

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

    this.presetFont = config.defaultFont;
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

    ctx.command('canvas.testCheeryBox').action(async () => {
      let canvas = this.createCanvas(1000, 200);
      let ctx = canvas.getContext('2d');

      let text = [
        {
          text: 'I like cookies!',
          color: '#ffffff',
          font: this.getPresetFont(),
          modifier: 'bold',
        },
      ];
      Canvas.cherryBox.textBox(ctx, 0, 0, 1000, 200, text, 200, [1, 1]);
      return h.image(canvas.toBuffer('image/png'), 'image/png');
    });
  }

  // @ts-ignore
  get logger(): Logger {
    return this.ctx?.logger(name) || new Logger(name);
  }

  async start() {
    let { nodeBinaryPath, fontPath } = this.config;
    const nodeDir = path.resolve(this.ctx.baseDir, nodeBinaryPath);
    const fontDir = path.resolve(this.ctx.baseDir, fontPath);
    await mkdir(nodeDir, { recursive: true });
    await mkdir(fontDir, { recursive: true });
    let nativeBinding: any;
    try {
      nativeBinding = await this.getNativeBinding(nodeDir);
    } catch (e) {
      if (e instanceof UnsupportedError) {
        this.logger.error('Canvas 目前不支持你的系统');
      }
      if (e instanceof DownloadError) {
        this.logger.error('下载二进制文件遇到错误，请查看日志获取更详细信息');
      }
      throw e;
    }

    this.Canvas = nativeBinding.Canvas;
    ({
      clearAllCache: this.clearAllCache,
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

    this.logger.success('Canvas 加载成功');

    this.fontsArray = this.GlobalFonts.families.map((obj) => obj.family);

    this.loadExtraFonts(fontDir).catch((e) =>
      this.logger.error('加载额外字体遇到了错误', e),
    );
  }

  private async loadExtraFonts(fontDir: string) {
    const extraFontNum = this.GlobalFonts.loadFontsFromDir(fontDir);

    const defaultfont = 'lxgw-wenkai-lite-v1.320';
    if (!fs.existsSync(path.join(fontDir, `${defaultfont}.tar.gz`))) {
      try {
        await downloadFonts(
          fontDir,
          'https://file.kylics.org/files/65e5c515b2d26/lxgw-wenkai-lite-v1.320.tar.gz',
          this.logger,
        );
      } catch (e) {
        this.logger.error(
          '下载预设字体遇到错误，这意味着我们无法保证在特殊系统上能渲染中文等字符。你可以手动下载 lxgw-wenkai-lite-v1.320.tar.gz 丢到字体文件夹下。',
        );
        this.logger.success(
          `已加载来自目录 ${fontDir} 的 ${extraFontNum} 个字体，但我们无法为您提供预设字体 ${defaultfont}。`,
        );
        return;
      }
    }

    const defaultFontNum = this.GlobalFonts.loadFontsFromDir(
      path.join(fontDir, defaultfont),
    );

    this.logger.success(
      `已加载来自目录 ${fontDir} 的 ${extraFontNum} 个字体，其中预载了 ${defaultfont} 的 ${defaultFontNum} 个字体。`,
    );
    // 把额外加载的字体提前
    const fonts = this.GlobalFonts.families.map((obj) => obj.family);
    this.fontsArray = fonts
      .slice(-(extraFontNum + defaultFontNum))
      .concat(fonts.slice(0, -(extraFontNum + defaultFontNum)));
  }

  private async getNativeBinding(nodeDir: string) {
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
      if (!localFileExisted)
        await handleFile(nodeDir, nodeName, this.logger, this.ctx.http);
      nativeBinding = require('@ahdg/canvas');
    } catch (e) {
      this.logger.error(
        'An error was encountered while processing the binary',
        e,
      );
      if (e instanceof DownloadError) {
        throw e;
      }
      throw new Error(`Failed to use ${nodePath} on ${platform}-${arch}`);
    }
    return nativeBinding;
  }
}

export namespace Canvas {
  export interface Config {
    nodeBinaryPath: string;
    fontPath: string;
    defaultFont: string;
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
      defaultFont: Schema.string().default('LXGW WenKai Lite'),
    }).i18n({
      zh: {
        nodeBinaryPath: 'Canvas 二进制存放目录',
        fontPath: 'Canvas 自定义字体存放目录',
        defaultFont: '通过指令 canvas 查看可以使用的字体并填写在此处。',
      },
    }),
  ]) as Schema<Config>;
}

export default Canvas;

function isMusl() {
  try {
    const lddPath = require('child_process')
      .execSync('which ldd')
      .toString()
      .trim();
    return fs.readFileSync(lddPath, 'utf8').includes('musl');
  } catch (e) {
    return true;
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
