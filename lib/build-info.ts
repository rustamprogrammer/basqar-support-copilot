export type BuildInfo = { commit: string | null; dirty: boolean | null; builtAt: string | null; mode: 'build' | 'serve' | 'unknown' };
declare const __BASQAR_BUILD_INFO__: BuildInfo;

// Vite replaces this constant in the bundle. Direct tests and source tools keep
// an explicit unknown value rather than accidentally naming the current checkout.
export const BUILD_INFO: BuildInfo = typeof __BASQAR_BUILD_INFO__ === 'undefined'
  ? { commit: null, dirty: null, builtAt: null, mode: 'unknown' }
  : __BASQAR_BUILD_INFO__;
