const got = require('got');
const FormDataClass = require('form-data');
const path = require('path');
const PromisePool = require('es6-promise-pool');
const fs = require('fs');

type Release = string | number | Function;
interface IOptionsConfig {
  baseURL: string
  org: string
  project: string | string[]
  authToken: string
  release: Release
  include?: RegExp
  exclude?: RegExp
  delMap?: boolean
  urlPrefix?: string
  errorHandler?: Function
  silent?: boolean
}

interface IFile {
  filePath: string,
  name: string
}

const SENTRY_BASE_URL: string = 'http://sentry-int.hua-yong.com';
const DEFAULT_DELETE_FILE_REGEX: RegExp = /\.map$/;
const DEFAULT_INCLUDE: RegExp = /\.js$|\.map$/;
const DEFAULT_URL_PREFIX = '~/';
module.exports = class {
  baseURL: string // sentry域名
  org: string // 组织名
  projects: string[] // 项目组名
  authToken: string // sentry token
  release: Release // 版本号
  include: RegExp // 需要上传的文件正则
  exclude: RegExp // 不需要上传的文件正则
  delMap: boolean // 是否删除map文件
  urlPrefix: string // sentry 显示的文件路径
  errorHandler: Function // 错误回调
  silent: boolean // 静默

  delFileRegExp: RegExp // 要删除的文件的正则

  constructor(opts: IOptionsConfig) {
    this.baseURL = (opts.baseURL || SENTRY_BASE_URL) + '/api/0';
    this.org = opts.org;
    this.projects = Array.isArray(opts.project) ? opts.project : [opts.project];
    this.authToken = opts.authToken;
    this.release = opts.release;
    this.include = opts.include || DEFAULT_INCLUDE;
    this.exclude = opts.exclude;
    this.delMap = opts.delMap;
    this.urlPrefix = opts.urlPrefix || DEFAULT_URL_PREFIX;

    this.delFileRegExp = DEFAULT_DELETE_FILE_REGEX;

    if (typeof this.release === 'function') {
      this.release = this.release();
    }

    this.validateOptRequired(opts);
  }

  apply(compiler): void {
    // 创建release-> sentry
    compiler.hooks.afterEmit.tapPromise('SentryPlugin', async compilation => {
      const files = this.getSourceFiles(compilation);
      try {
        await this.createRelease();
        await this.uploadSourceMap(files);
      } catch (e) {
        createError(e.message);
      }
    });

    // 删除 map 文件
    compiler.hooks.done.tapPromise('SentryPlugin', async stats => {
      if (!this.delMap) return;
      await this.deleteLocalSourceMap(stats);
    });
  }

  private validateOptRequired(opts: IOptionsConfig): never | void {
    const {
      baseURL,
      org,
      project,
      authToken,
      release,
    } = opts;

    if (!baseURL) {
      createError('`baseURL` option is required');
    }
    if (!org) {
      createError('`org` option is required');
    }
    if (!project || (Array.isArray(project) && !project.length)) {
      createError('`project` option is required');
    }
    if (!authToken) {
      createError('`authToken` option is required');
    }
    if (!release) {
      createError('`release` option is required');
    }
  }

  private isIncludeOrExclude(filename) {
    const isIncluded: boolean = this.include ? this.include.test(filename) : true;
    const isExcluded: boolean = this.exclude ? this.exclude.test(filename) : false;

    return isIncluded && !isExcluded;
  }

  private getSourceFiles(compilation): IFile[] {
    return Object.keys(compilation.assets).map((name) => {
      if (this.isIncludeOrExclude(name)) {
        return {
          name,
          filePath: transformAssetPath(compilation, name)
        }
      }
      return null
    }).filter(file => file);
  }

  private createRelease(): Promise<any> {
    const client = got.extend({
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${this.authToken}`
      },
    });

    return client.post(`${this.baseURL}/organizations/${this.org}/releases/`, {
      body: JSON.stringify({
        version: this.release,
        projects: this.projects
      })
    })
  }

  private uploadSourceMap(files: any[]): Promise<void> {
    const upload = (file: IFile) => {
      const { filePath, name } = file;
      const formData = new FormDataClass();
      formData.append('file', fs.createReadStream(filePath));
      formData.append('name', this.urlPrefix + name);
      const client = got.extend({
        headers: {
          authorization: `Bearer ${this.authToken}`
        }
      });
      return client.post(`${this.baseURL}/organizations/${this.org}/releases/${this.release}/files/`, {
        body: formData
      });
    }

    const pool = new PromisePool(() => {
      const file = files.pop()
      if (!file) return;
      return upload(file);
    }, Infinity);

    return new Promise(resolve => {
      pool.start().then(() => resolve());
    });

  }
  private deleteLocalSourceMap(stats: any) {
    const { compilation } = stats;
    Object.keys(compilation.assets)
      .filter(name => this.delFileRegExp.test(name))
      .forEach(mapName => {
        const filePath = transformAssetPath(stats.compilation, mapName);
        if (filePath) {
          try {
            // del map文件
            fs.unlinkSync(filePath);
            // del map引用 //# sourceMappingURL=app.fa089f0a.js.map
            let nameArr: string[] = mapName.split('/');
            let oriFileName: string = nameArr[nameArr.length - 1];
            const oriFilePath: string = filePath.replace(/\.map/, '');
            const oriFileData = fs.readFileSync(oriFilePath, 'utf-8');
            const regexp = new RegExp(`\\/\\/\\s*?\\#\\s*?sourceMappingURL\\s*?\\=\\s*?${oriFileName.replace(/\./g, '\\.')}\\s*?$`);
            fs.writeFileSync(oriFilePath, oriFileData.replace(regexp, ''));
          } catch (e) {
            createError(e.message);
          }
        }
      });
  }
};


function transformAssetPath(compilation: any, name: string): string {
  return path.join(compilation.compiler.outputPath, name.split('?')[0]);
}

class SentryError extends Error {
  message: string
  code?: string
  constructor({ message, code }) {
    super('Sentry Plugin Error: ' + message);
    this.code = code;
    Object.setPrototypeOf(this, SentryError.prototype);
  }
}

function createError(message: string, code?: string): never | void {
  throw new SentryError({ message, code });
}