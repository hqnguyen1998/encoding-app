import type { EncoderApi } from '../shared/types';

declare global {
  interface Window {
    encoder: EncoderApi;
  }
}

export {};
