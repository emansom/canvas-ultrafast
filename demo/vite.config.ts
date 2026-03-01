import { defineConfig, type Plugin } from 'vite';
import minifyHtml from '@minify-html/node';
import { buildHash, sharedEsbuildOptions, sharedTreeshake, sharedCompactOutput, sharedCompressionPlugins } from '../vite.config.shared';

function htmlMinifyPlugin(): Plugin {
  return {
    name: 'html-minify',
    transformIndexHtml(html) {
      return minifyHtml.minify(Buffer.from(html), { minify_css: true, minify_js: true, minify_doctype: true }).toString();
    },
  };
}

export default defineConfig(({ mode }) => {
  const dev = mode === 'development';

  return {
    plugins: [...sharedCompressionPlugins(dev), ...(!dev ? [htmlMinifyPlugin()] : [])],
    build: {
      sourcemap: dev,
      minify: dev ? false : 'esbuild',
      rollupOptions: {
        treeshake: sharedTreeshake,
        output: {
          ...sharedCompactOutput,
          entryFileNames: `assets/[name]-[hash]-${buildHash}.js`,
          chunkFileNames: `assets/[name]-[hash]-${buildHash}.js`,
          assetFileNames: `assets/[name]-[hash]-${buildHash}.[ext]`,
        },
      },
    },
    esbuild: sharedEsbuildOptions(dev),
  };
});
