import got from 'got';
import FormData from 'form-data';
import path from 'path';
import PromisePool from 'es6-promise-pool';

const fs = require('fs');

// // const client = got.extend({
// //   headers: {
// //     'Content-Type': 'application/json',
// //     authorization: 'Bearer 256f6da2b2ae447695d4d72aebed48136b994c8f0ba2441ca5090d40f47bd41d'
// //   },
// // });

// // client.post('http://sentry-int.hua-yong.com/api/0/organizations/huayong/releases/', {
// //   body: JSON.stringify({ version: 'test-plug-0.0.2', projects: ['apollo-anlle'] })
// // }).then(data => {
// //   console.log(data);
// // })


// const formData = new FormData();
// formData.append('file', fs.createReadStream('./test-upload.js'));
// formData.append('name', '~/test-upload-01.js');
// const client = got.extend({
//   headers: {
//     authorization: 'Bearer 256f6da2b2ae447695d4d72aebed48136b994c8f0ba2441ca5090d40f47bd41d'
//   }
// });
// client.post('http://sentry-int.hua-yong.com/api/0/organizations/huayong/releases/test-plug-0.0.2/files/', {
//   body: formData
// }).then(data => {
//   console.log(data);
// });

type Release = string | number | Function;

interface OptionsConfig {
  baseURL: string
  org: string
  projects: string | string[]
  authToken: string
  release: Release
  include?: RegExp
  exclude?: RegExp
  delMap?: boolean
  errorHandler?: Function
}

interface File {
  filePath: string,
  name: string
}

const SENTRY_BASE_URL: string = 'http://sentry-int.hua-yong.com';
const DEFAULT_DELETE_FILE_REGEX: RegExp = /\.map$/;
const DEFAULT_INCLUDE: RegExp = /\.js$|\.map$/;

const ERROR_HEADER: string = 'Sentry Error：';
const ERROR_INFO = {
  'error_001': ERROR_HEADER + ''
}

export default class {
  baseURL: string
  org: string
  projects: string[]
  authToken: string
  release: Release
  include: RegExp
  exclude: RegExp
  delFileRegExp: RegExp

  constructor(opts: OptionsConfig) {
    this.baseURL = (opts.baseURL || SENTRY_BASE_URL) + '/api/0';
    this.org = opts.org;
    this.projects = Array.isArray(opts.projects) ? opts.projects : [opts.projects];
    this.authToken = opts.authToken;
    this.release = opts.release;
    this.include = opts.include;
    this.exclude = opts.exclude;

    this.delFileRegExp = DEFAULT_DELETE_FILE_REGEX;

    if (typeof this.release === 'function') {
      this.release = this.release();
    }

    // todo
    // 校验必传参数
    // todo end

  }

  apply(compiler): void {
    // 创建release-> sentry
    compiler.hooks.afterEmit.tapPromise('SentryPlugin', async compilation => {
      const files = this.getSourceFiles(compilation);
      await this.createRelease();
      await this.uploadSourceMap(files);
      // todo  报错信息
    });

    // 删除 map 文件
    compiler.hooks.done.tapPromise('SentryPlugin', async stats => {
      await this.deleteLocalSourceMap(stats);
    });
  }

  private validateOptRequired(opts: OptionsConfig): boolean {
    return false;
  }

  private isIncludeOrExclude(filename) {
    const isIncluded: boolean = this.include ? this.include.test(filename) : true;
    const isExcluded: boolean = this.exclude ? this.exclude.test(filename) : false;

    return isIncluded && !isExcluded;
  }

  private getSourceFiles(compilation): File[] {
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

    return client.post(`http://sentry-int.hua-yong.com/api/0/organizations/huayong/releases/`, {
      body: JSON.stringify({
        version: this.release,
        projects: this.projects
      })
    })
  }

  private uploadSourceMap(files: any[]): Promise<void> {
    const upload = (file: File) => {
      const { filePath, name } = file;
      const formData = new FormData();
      formData.append('file', filePath);
      formData.append('name', '~/' + name);
      const client = got.extend({
        headers: {
          authorization: 'Bearer 256f6da2b2ae447695d4d72aebed48136b994c8f0ba2441ca5090d40f47bd41d'
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
          // del map文件
          fs.unlinkSync(filePath);
          // del map引用
          const oriFilePath = filePath.replace(/\.map/, '');
          const oriFileData = fs.readFileSync(oriFilePath, 'utf-8');
          const regexp = new RegExp(`\\/\\/\\s*?\\#\\s*?sourceMappingURL\\s*?\\=\\s*?${oriFilePath.replace(/\./g, '\\.')}\\s*?$`);
          fs.writeFileSync(oriFilePath, oriFileData.replace(regexp, ''));
        }
      });
      // todo 删除文件错误得信息
    // # sourceMappingURL=app.fa089f0a.js.map
  }
};


function transformAssetPath(compilation: any, name: string): string {
  return path.join(compilation.compiler.outputPath, name.split('?')[0]);
}