const fs = require('fs');
const got = require('got');
const FormDataClass = require('form-data');
const PromisePool = require('es6-promise-pool');

import { createError } from './error';
import Logger from './logger';
import { transformAssetPath } from '../utils';
import { Release, IOptionsConfig, IFile, SENTRY_BASE_URL, DEFAULT_INCLUDE, DEFAULT_URL_PREFIX, DEFAULT_DELETE_FILE_REGEX } from '../types';

class Sentry {
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
  errAbort: boolean // 报错是否终止打包

  delFileRegExp: RegExp // 要删除的文件的正则
  logger: any // webpack logger对象

  constructor(opts: IOptionsConfig) {
    this.baseURL = (opts.baseURL || SENTRY_BASE_URL).replace(/\/$/, '') + '/api/0';
    this.org = opts.org;
    this.projects = Array.isArray(opts.project) ? opts.project : opts.project ? [opts.project] : null;
    this.authToken = opts.authToken;
    this.release = opts.release;
    this.include = opts.include || DEFAULT_INCLUDE;
    this.exclude = opts.exclude;
    this.delMap = opts.delMap;
    this.urlPrefix = opts.urlPrefix || DEFAULT_URL_PREFIX;
    this.errAbort = !!opts.errAbort;

    this.delFileRegExp = DEFAULT_DELETE_FILE_REGEX;

    if (typeof this.release === 'function') {
      this.release = this.release();
    }
  }

  apply(compiler): void {
    this.logger = new Logger(compiler);

    let valid = this.validateOptRequired();
    if (!valid) return;

    // 创建release-> sentry
    compiler.hooks.afterEmit.tapPromise('SentryPlugin', async compilation => {
      const files = this.getSourceFiles(compilation);
      try {
        await this.createRelease();
        await this.uploadSourceMap(files);
        this.logger.info('success: sourcemap upload to complete!');
      } catch (err) {
        this.log(err.message);
      }
    });

    // 删除 map 文件
    compiler.hooks.done.tapPromise('SentryPlugin', async stats => {
      if (!this.delMap) return;
      await this.deleteLocalSourceMap(stats);
    });
  }

  private validateOptRequired(): never | boolean {
    const {
      baseURL,
      org,
      projects,
      authToken,
      release,
    } = this;

    if (!baseURL) {
      this.log('`baseURL` option is required');
      return false;
    }
    if (!org) {
      this.log('`org` option is required');
      return false;
    }
    if (!projects) {
      this.log('`project` option is required');
      return false;
    }
    if (!authToken) {
      this.log('`authToken` option is required');
      return false;
    }
    if (!release) {
      this.log('`release` option is required');
      return false;
    }
    return true;
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

    return new Promise((resolve, reject) => {
      client.post(`${this.baseURL}/organizations/${this.org}/releases/`, {
        body: JSON.stringify({
          version: this.release,
          projects: this.projects
        })
      }).then(res => resolve(res)).catch(err => {
        reject({ message: `releases create fail, ${err.message}` });
      });
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
      return new Promise((resolve, reject) => {
        client.post(`${this.baseURL}/organizations/${this.org}/releases/${this.release}/files/`, {
          body: formData
        }).then(res => resolve(res)).catch(err => {
          reject({ message: `sourcemap upload fail, ${err.message}, ${filePath}` });
        });
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
            this.log(`delete sourcemap fail, ${e.message}`);
          }
        }
      });
  }

  private log(message: string): never | void {
    if (!this.silent) {
      if (this.errAbort) {
        createError(message);
      } else {
        this.logger.error(message);
      }
    }
  }
};

export default Sentry
