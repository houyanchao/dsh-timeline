/**
 * 树外 DSH 客户端插件的 tsdown 配置：复刻 deepseekharness 的 clientBundle 约定。
 * - lib/index.js：Node 半（Loader 在 host 进程加载）
 * - lib/client.js：浏览器半，closure-factory 形态 —— bundle 调用
 *   window.__ModuleLoader__.load({ id, factory })，externals 通过注入的
 *   require 从加载器模块表解析（react、cordis、ui-slots 等平台模块）。
 * - CSS Modules 由 lightningcss 内联编译：import x.module.css 得到 hash 类名映射，
 *   css 文本在 factory 执行时注入 <style data-plugin>（卸载时由加载器移除）。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

// 必须与 package.json 的 name 一致：浏览器端按包名匹配 __ModuleLoader__ 注册 id。
const PLUGIN_ID = 'dsh-timeline'

/** 平台模块表（与 deepseekharness packages/client/web/src/platform.ts 保持一致）。 */
const CLIENT_EXTERNALS: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

const lib: UserConfig = {
  name: PLUGIN_ID,
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: false,
}

const client: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  // 模块表之外的依赖一律内联；表内条目保持 external（由注入 require 解析）。
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [{
    name: 'dsh-css-modules-inline',
    async resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
      const hash = createHash('sha1').update(await readFile(abs)).digest('hex').slice(0, 10)
      return `${CSS_VIRTUAL_PREFIX}${abs}?${hash}${CSS_VIRTUAL_SUFFIX}`
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const rest = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      const q = rest.lastIndexOf('?')
      const fileId = q === -1 ? rest : rest.slice(0, q)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${PLUGIN_ID}/${basename(fileId)}`)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [lib, client]
