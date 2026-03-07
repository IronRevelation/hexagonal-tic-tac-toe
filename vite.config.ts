import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

function isIgnoredClientDirectiveWarning(warning: {
  code?: string
  id?: string
  message: string
}) {
  return (
    warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
    warning.message.includes('"use client"') &&
    typeof warning.id === 'string' &&
    warning.id.includes('/node_modules/')
  )
}

const config = defineConfig({
  build: {
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (isIgnoredClientDirectiveWarning(warning)) {
          return
        }

        defaultHandler(warning)
      },
    },
  },
  plugins: [
    devtools(),
    nitro({
      rollupConfig: {
        external: [/^@sentry\//],
      },
      hooks: {
        'rollup:before': (_nitro, rollupConfig) => {
          const previousOnWarn = rollupConfig.onwarn

          rollupConfig.onwarn = (warning, defaultHandler) => {
            if (isIgnoredClientDirectiveWarning(warning)) {
              return
            }

            if (typeof previousOnWarn === 'function') {
              return previousOnWarn(warning, defaultHandler)
            }

            defaultHandler(warning)
          }
        },
      },
    }),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
