export let logConfig = {
  enabled: false,
};

export function log(...args: any[]) {
  if (!logConfig.enabled) {
    return;
  }

  console.error(...args);
}
