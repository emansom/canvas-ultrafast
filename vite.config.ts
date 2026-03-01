import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import { sharedEsbuildOptions, sharedTreeshake, sharedCompactOutput, sharedCompressionPlugins } from './vite.config.shared';

export default defineConfig(({ mode }) => {
  const dev = mode === 'development';

  return {
    plugins: [
      dts({
        rollupTypes: true,
      }),
      ...sharedCompressionPlugins(dev),
    ],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'CanvasUltrafast',
        formats: ['es', 'umd'],
        fileName: (format) => `canvas-ultrafast.${format}.js`
      },
      rollupOptions: {
        treeshake: sharedTreeshake,
        output: sharedCompactOutput,
      },
      sourcemap: dev,
      minify: dev ? false : 'esbuild',
      outDir: 'dist',
      emptyOutDir: true,
    },
    esbuild: {
      ...sharedEsbuildOptions(dev),
      mangleProps: !dev ? /^_/ : undefined,
      mangleQuoted: !dev,
    },
  };
});
