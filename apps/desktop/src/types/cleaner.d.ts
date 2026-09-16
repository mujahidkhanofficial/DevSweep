import { cleanerApi } from '../../electron/preload/index.js';

declare global {
  interface Window {
    devsweep: typeof cleanerApi;
    cleaner: typeof cleanerApi;
  }
}
