import fetch, { Response, BodyInit } from 'node-fetch';
import { URL } from 'url';
import { Agent, AgentOptions } from 'http';
import * as discovery from './discovery';
import * as openapi from './openapi';
import { Group, Resource, Object, Definition } from './interfaces';
import { APIError } from './errors';
import { log } from './log';

export default class API {
  private _ready = false;

  agent?: Agent;
  apiURL?: string;
  groups: {[groupName: string]: Group} = {};
  definitions: {[id: string]: Definition} = {};

  get ready() {
    return this._ready;
  }

  configure(options: {apiURL?: string, socketPath?: string}): Promise<void> {
    this.groups = {};
    this.definitions = {};

    if (options.apiURL) {
      this.apiURL = options.apiURL;
      this.agent = undefined;
    } else if (options.socketPath) {
      this.apiURL = 'http://localhost';
      this.agent = new Agent({
        socketPath: options.socketPath,
      } as AgentOptions);
    } else {
      throw Error('Either apiURL or socketPath should be set');
    }

    return (async () => {
      let fetch = (uri: string) => this.fetch(uri).then(r => r.json());
      let definitionsPromise = openapi.loadDefinitions(fetch);
      this.groups = await discovery.discoverAllGroups(fetch);
      this.definitions = await definitionsPromise;

      for (let def of Object.values(this.definitions)) {
        let gvks = def['x-kubernetes-group-version-kind'];
        if (!gvks) {
          continue;
        }

        if ('properties' in def && def.properties?.status) {
          def.properties.status.readOnly = true;
        }

        for (let gvk of gvks) {
          let group = this.groups[gvk.group];
          if (!group) {
            continue;
          }
          let groupVersion = group.versions[gvk.version];
          if (!groupVersion) {
            continue;
          }
          let resource = groupVersion.resourcesByKind[gvk.kind];
          if (!resource) {
            continue;
          }
          resource.definition = def;
        }
      }

      this._ready = true;
    })();
  }

  async list(resource: Resource, namespace?: string): Promise<Object[]> {
    let uri = this.getResourceUri(resource, namespace);
    let objectList = await this.fetch(uri).then(r => r.json()) as any;

    // decorate
    let apiVersion = resource.groupVersion.group.name + '/' + resource.groupVersion.version;
    if (apiVersion[0] === '/') {
      apiVersion = resource.groupVersion.version;
    }
    for (let obj of objectList.items) {
      obj.apiVersion = apiVersion;
      obj.kind = resource.kind;
    }

    return objectList.items;
  }

  getObjectUri(obj: Object): string {
    let resource = this.getResource(obj);
    return this.getResourceUri(resource, obj.metadata.namespace) + '/' + obj.metadata.name;
  }

  getResourceUri(resource: Resource, namespace?: string): string {
    let uri;
    if (resource.groupVersion.group.name === '') {
      uri = 'api';
    } else {
      uri = 'apis/' + resource.groupVersion.group.name;
    }
    uri += '/' + resource.groupVersion.version;
    if (resource.namespaced) {
      uri += '/namespaces/' + (namespace ?? 'default');
    }
    uri += '/' + resource.name;
    return uri;
  }

  getResource(obj: Object): Resource;
  getResource(groupVersion: string, kind: string): Resource;
  getResource(a: any, b?: any): Resource {
    let groupVersion, kind;

    if (typeof a !== 'string') {
      let obj = a as Object;
      groupVersion = obj.apiVersion;
      kind = obj.kind;
    } else {
      groupVersion = a;
      kind = b;
    }

    let groupName, version;
    let separatorPos = groupVersion.indexOf('/');

    if (separatorPos === -1) {
      groupName = '';
      version = groupVersion;
    } else {
      groupName = groupVersion.slice(0, separatorPos);
      version = groupVersion.slice(separatorPos + 1);
    }

    let group = this.groups[groupName];
    if (!group) {
      throw new Error(`Unknown group ${groupName}`);
    }

    let gv = group.versions[version];
    if (!gv) {
      throw new Error(`Unknown version ${groupVersion}`);
    }

    let resource = gv.resourcesByKind[kind];
    if (!resource) {
      throw new Error(`Unknown kind ${kind} in group version ${groupVersion}`);
    }

    return resource;
  }

  async fetch(uri: string, accept = 'application/json'): Promise<Response> {
    return this.request('GET', uri, {accept});
  }

  async put(uri: string, body: BodyInit, contentType = 'application/json', accept = 'application/json'): Promise<Response> {
    return this.request('PUT', uri, {body, contentType, accept});
  }

  async delete(uri: string, accept = 'application/json'): Promise<Response> {
    return this.request('DELETE', uri, {accept});
  }

  async post(uri: string, body: BodyInit, contentType = 'application/json', accept = 'application/json'): Promise<Response> {
    return this.request('POST', uri, {body, contentType, accept});
  }

  async request(method: string, uri: string, options: {accept: string, contentType?: string, body?: BodyInit}): Promise<Response> {
    log(method, uri);

    let url = new URL(uri, this.apiURL);
    let headers: any = {
      Accept: options.accept,  // eslint-disable-line @typescript-eslint/naming-convention
    };

    if (options.contentType) {
      headers['Content-Type'] = options.contentType;
    }

    let response = await fetch(url.toString(), {
      method: method,
      body: options.body,
      headers: headers,
      agent: this.agent,
    });

    if (!response.ok) {
      console.error(method, uri, response.status);
      let err = await APIError.fromResponse(response);
      throw err;
    }

    return response;
  }
}
