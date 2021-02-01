import { CONSOLE_LOG_HEADER } from '../types';

export default class {
  private logger: any
  constructor(compiler) {
    this.logger = compiler.getInfrastructureLogger(CONSOLE_LOG_HEADER);;
  }
  info(message: string) {
    return this.logger.info(message);
  }
  error(message: string) {
    return this.logger.error('Error: ' + message);
  }
  warn(message: string) {
    return this.logger.warn('Warning: ' + message);
  }
}