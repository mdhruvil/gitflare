export function createLogger(namespace?: string, fullRepoName?: string) {
  const argsStr = [fullRepoName, namespace]
    .filter(Boolean)
    .map((s) => `[${s}]`)
    .join(" ");
  return {
    info: (...args: unknown[]) => {
      console.log(`[INFO] ${argsStr}`, ...args);
    },
    warn: (...args: unknown[]) => {
      console.log(`[WARN] ${argsStr}`, ...args);
    },
    error: (...args: unknown[]) => {
      console.log(`[ERROR] ${argsStr}`, ...args);
    },
    debug: (...args: unknown[]) => {
      console.log(`[DEBUG] ${argsStr}`, ...args);
    },
  };
}
