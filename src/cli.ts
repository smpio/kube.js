#!/usr/bin/env node

import * as fs from 'fs/promises';
import { Command } from 'commander';
import API from './api';
import { startProxy } from './proxy';
import { parse, stringify } from './yaml';
import cleanObject from './clean';

const api = new API();
const program = new Command();

interface GlobalOptions {
  apiUrl?: string;
}

async function init() {
  let opts = program.opts<GlobalOptions>();

  if (opts.apiUrl) {
    await api.configure({apiURL: opts.apiUrl});
  } else {
    let proxy = await startProxy();
    await api.configure({socketPath: proxy.socketPath});
    process.on('exit', proxy.dispose);
  }
}

function command(fn: (...args: any[]) => number | Promise<number>) {
  return async (...args: any[]) => {
    await init();

    let ret = fn(...args);
    if (ret instanceof Promise) {
      ret = await ret;
    }

    process.exit(ret);
  };
}

const clean = command(async (filename: string) => {
  let manifest = await fs.readFile(filename, 'utf8');
  let obj = parse(manifest);
  cleanObject(obj, api);
  manifest = stringify(obj);
  process.stdout.write(manifest);
  return 0;
});

program.name('kube')
  .option('--api-url <url>', 'URL of Kubernetes API server (if not specified, will start background `kubectl proxy`)');

program.command('clean')
  .description('clean manifest, deleting read-only fields and fields with defaults')
  .argument('[filename]', 'name of the file containing manifest', '/dev/stdin')
  .action(clean);

program.parse();
