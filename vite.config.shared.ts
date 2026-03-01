/**
 * Shared Vite build optimizations used by both the library and demo project.
 * Library-specific settings (mangleProps, worker config, lib formats) stay in each config.
 */

import type { ESBuildOptions, Plugin } from 'vite';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { compression, defineAlgorithm } from 'vite-plugin-compression2';

/** 8-char hex string unique per `vite build` invocation. */
export const buildHash = crypto.randomBytes(4).toString('hex');

type Drop = ('console' | 'debugger')[];

export function sharedEsbuildOptions(dev: boolean): ESBuildOptions {
  return {
    target: 'esnext',
    minifyIdentifiers: !dev,
    minifyWhitespace: !dev,
    minifySyntax: !dev,
    treeShaking: !dev,
    ignoreAnnotations: !dev,
    legalComments: dev ? 'inline' : 'none',
    drop: dev ? ([] as Drop) : ['console'],
  };
}

export const sharedTreeshake = {
  moduleSideEffects: false,
  propertyReadSideEffects: false,
  tryCatchDeoptimization: false,
} as const;

export function sharedCompressionPlugins(dev: boolean): Plugin[] {
  if (dev) return [];
  return [
    compression({
      algorithms: [
        defineAlgorithm('gzip', {
          level: zlib.constants.Z_BEST_COMPRESSION,
          memLevel: 9,
        }),
        defineAlgorithm('brotliCompress', {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          },
        }),
        defineAlgorithm('zstd', {
          params: {
            [zlib.constants.ZSTD_c_compressionLevel]: 22,
            [zlib.constants.ZSTD_c_strategy]: zlib.constants.ZSTD_btultra2,
          },
        }),
      ],
      threshold: 512,
    }),
  ];
}

export const sharedCompactOutput = {
  compact: true,
  minifyInternalExports: true,
  generatedCode: {
    arrowFunctions: true,
    constBindings: true,
    objectShorthand: true,
  },
} as const;
