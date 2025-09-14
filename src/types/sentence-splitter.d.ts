// src/types/sentence-splitter.d.ts
declare module 'sentence-splitter' {
  export interface SentenceSplitterOptions {
    separator?: string;
  }
  export interface Sentence {
    type: string;
    raw: string;
    range: [number, number];
  }
  export function split(text: string, options?: SentenceSplitterOptions): Sentence[];
}
