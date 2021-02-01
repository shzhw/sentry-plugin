export type Release = string | number | Function;

export interface IOptionsConfig {
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
  errAbort?: Boolean
}

export interface IFile {
  filePath: string,
  name: string
}

export const SENTRY_BASE_URL: string = 'http://sentry-int.hua-yong.com';
export const DEFAULT_DELETE_FILE_REGEX: RegExp = /\.map$/;
export const DEFAULT_INCLUDE: RegExp = /\.js$|\.map$/;
export const DEFAULT_URL_PREFIX: string = '~/';
export const CONSOLE_LOG_HEADER = 'Sentry Plugin';
