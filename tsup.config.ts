import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {index:'src/index.ts',react:'src/react.ts'},
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    splitting: false,
    //minify: true,
    // Cleans the output directory before starting a fresh compilation pass
    clean: true,
    external: ['react', 'react-dom'],
});