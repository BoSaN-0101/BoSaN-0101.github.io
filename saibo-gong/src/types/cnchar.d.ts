declare module 'cnchar' {
  const cnchar: { use(...plugins: unknown[]): void; stroke(text: string): number | number[] };
  export default cnchar;
}
declare module 'cnchar-trad' {
  const trad: unknown;
  export default trad;
}
