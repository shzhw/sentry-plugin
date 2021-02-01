
import * as path from 'path'; 

export function transformAssetPath(compilation: any, name: string): string {
  return path.join(compilation.compiler.outputPath, name.split('?')[0]);
}