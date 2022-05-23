import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as child_process from 'child_process';
import fetch from 'node-fetch';
import { promisify } from 'util';
import { Agent, AgentOptions } from 'http';
import { ChildProcess } from 'child_process';
import { log } from './log';

const exec = promisify(child_process.exec);
const timeout = promisify(setTimeout);

const SOCKET_CREATE_TIMEOUT = 10000;
const API_READY_TIMEOUT = 10000;

export interface Proxy {
  socketPath: string;
  dispose: () => void;
}

export interface ProxyWithContext extends Proxy {
  context: string;
}

interface ProxyWithOptionalContext extends Proxy {
  context?: string;
}

export async function startProxy(): Promise<Proxy>;
export async function startProxy(context: string): Promise<ProxyWithContext>;
export async function startProxy(context?: string): Promise<ProxyWithOptionalContext> {
  let socketPath = path.join(os.tmpdir(), `kubectl-proxy-${process.pid}.sock`);
  let cmd: string[];
  if (context) {
    cmd = ['kubectl', '--context', context, 'proxy', '--unix-socket', socketPath];
  } else {
    cmd = ['kubectl', 'proxy', '--unix-socket', socketPath];
  }
  let disposed = false;
  log(`Running ${cmd.join(' ')}`);

  unlinkSafe(socketPath);
  let child = await spawnReady(cmd, socketPath);
  child.on('exit', handleExit);

  async function handleExit(code: number) {
    if (disposed) {
      return;
    }
    log(`Command ${cmd} exited with code ${code}, restarting`);
    unlinkSafe(socketPath);
    child = await spawnReady(cmd, socketPath);
    child.on('exit', handleExit);
  }

  return {
    context,
    socketPath,
    dispose: () => {
      disposed = true;
      child.kill();
    },
  };
}

export async function getDefaultContext(): Promise<string> {
  const { stdout } = await exec('kubectl config current-context');
  return stdout.trim();
}

export async function getContexts(): Promise<string[]> {
  const { stdout } = await exec('kubectl config get-contexts -oname');
  return stdout.split('\n').slice(0, -1);
}

async function spawnReady(cmd: string[], socketPath: string): Promise<ChildProcess> {
  let child = await spawnSocket(cmd, socketPath);

  let agent = new Agent({socketPath} as AgentOptions);
  let requestDelay = 100;

  for (let i = 0; i < API_READY_TIMEOUT; i += requestDelay) {
    try {
      await fetch('http://localhost/version', {agent});
      return child;
    } catch(err) {}
    await timeout(requestDelay);
  }

  child.kill();
  throw new Error(`Timeout waiting for API on ${cmd}`);
}

function spawnSocket(cmd: string[], socketPath: string): Promise<ChildProcess> {
  return new Promise((resolve, rejectOrig) => {
    let child = child_process.spawn(cmd[0], cmd.slice(1));
    let resolved = false;

    function reject(err: Error) {
      resolved = true;
      rejectOrig(err);
    }

    child.on('exit', (code) => {
      reject(new Error(`Command ${cmd} finished too early with code ${code}`));
    });
    child.on('error', reject);

    async function checkSocket() {
      if (resolved) {
        return;
      }

      try {
        await fs.stat(socketPath);
      } catch(err) {
        setTimeout(checkSocket, 100);
      }

      resolved = true;
      resolve(child);
    }

    checkSocket();

    setTimeout(() => {
      if (resolved) {
        return;
      }
      resolved = true;
      child.kill();
      reject(new Error(`Timeout waiting for ${cmd} to create socket`));
    }, SOCKET_CREATE_TIMEOUT);
  });
}

async function unlinkSafe(path: string) {
  try {
    return await fs.unlink(path);
  } catch(err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}
