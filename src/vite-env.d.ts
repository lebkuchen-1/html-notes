/// <reference types="vite/client" />

declare const __APP_COMMIT__: string;
declare const __APP_BUILD_TIME__: string;

declare module 'nspell' {
  interface NSpellInstance {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpellInstance;
    remove(word: string): NSpellInstance;
    personal(dic: string): NSpellInstance;
  }

  function nspell(aff: string, dic?: string): NSpellInstance;
  function nspell(dict: { aff: string; dic: string }): NSpellInstance;
  export default nspell;
}
