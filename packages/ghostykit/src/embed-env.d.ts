// El CSS de Piloto (`dist/styles.css`) incrustado como texto por `scripts/build-embed.mjs`.
declare module "piloto:styles" {
  const css: string;
  export default css;
}
// La versión del paquete, la pone esbuild al construir.
declare const __GHOSTYKIT_VERSION__: string;
