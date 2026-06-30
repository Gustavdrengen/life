/// <reference types="svelte" />
/// <reference types="vite/client" />

// Vite `?raw` import — text file imported as a string.
// Without this declaration TypeScript rejects the import.
declare module '*?raw' {
  const content: string;
  export default content;
}
