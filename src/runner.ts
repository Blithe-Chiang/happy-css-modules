import { resolve } from 'path';
import * as process from 'process';
import * as util from 'util';
import chalk from 'chalk';
import * as chokidar from 'chokidar';
import AggregateError from 'es-aggregate-error';
import _glob from 'glob';
import { emitGeneratedFiles } from './emitter/index.js';
import { Loader, type Transformer } from './loader/index.js';

const glob = util.promisify(_glob);

export type Watcher = {
  close: () => Promise<void>;
};

export type LocalsConvention = 'camelCase' | 'camelCaseOnly' | 'dashes' | 'dashesOnly' | undefined;

export interface RunnerOptions {
  pattern: string;
  outDir?: string;
  watch?: boolean;
  localsConvention?: LocalsConvention;
  namedExport?: boolean;
  declarationMap?: boolean;
  transformer?: Transformer;
  /**
   * Silent output. Do not show "files written" messages.
   * @default false
   */
  silent?: boolean;
  /** Working directory path. */
  cwd?: string;
}

type OverrideProp<T, K extends keyof T, V extends T[K]> = Omit<T, K> & { [P in K]: V };

/**
 * Run typed-css-module.
 * @param options Runner options.
 * @returns Returns `Promise<Watcher>` if `options.watch` is `true`, `Promise<void>` if `false`.
 */
export async function run(options: OverrideProp<RunnerOptions, 'watch', true>): Promise<Watcher>;
export async function run(options: RunnerOptions): Promise<void>;
export async function run(options: RunnerOptions): Promise<Watcher | void> {
  const loader = new Loader({ transformer: options.transformer });
  const distOptions = options.outDir
    ? {
        rootDir: process.cwd(), // TODO: support `--rootDir` option
        outDir: options.outDir,
      }
    : undefined;

  async function processFile(filePath: string) {
    try {
      const result = await loader.load(filePath);
      await emitGeneratedFiles({
        filePath,
        tokens: result.tokens,
        distOptions,
        emitDeclarationMap: options.declarationMap,
        dtsFormatOptions: {
          localsConvention: options.localsConvention,
          namedExport: options.namedExport,
        },
        silent: options.silent ?? false,
        cwd: options.cwd ?? process.cwd(),
      });
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
      console.error(chalk.red('[Error] ' + error));
      throw error;
    }
  }

  if (options.watch) {
    if (!options.silent) console.log('Watch ' + options.pattern + '...');
    const watcher = chokidar.watch([options.pattern.replace(/\\/g, '/')], { cwd: options.cwd });
    watcher.on('all', (eventName, filePath) => {
      if (eventName === 'add' || eventName === 'change') {
        processFile(resolve(options.cwd ?? process.cwd(), filePath)).catch(() => {
          // TODO: Emit a error by `Watcher#onerror`
        });
      }
    });
    return { close: async () => watcher.close() };
  } else {
    const filePaths = (await glob(options.pattern, { dot: true, cwd: options.cwd ?? process.cwd() }))
      // convert relative path to absolute path
      .map((file) => resolve(options.cwd ?? process.cwd(), file));

    // TODO: Use `@file-cache/core` to process only files that have changed
    const errors: unknown[] = [];
    for (const filePath of filePaths) {
      await processFile(filePath).catch((e: unknown) => errors.push(e));
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Failed to process files');
  }
}
