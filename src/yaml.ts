import * as YAML from 'yaml';


// disable "folding" of block scalars, which replaces "|" with ">"
YAML.scalarOptions.str.fold.lineWidth = 0;

export interface YAMLOptions {
  decodeSecrets: boolean;
}

const DEFAULT_OPTIONS = {
  decodeSecrets: false
};

export function parse(str: string): any {
  let value = YAML.parse(str, {
    version: '1.1',
  });

  if (value.apiVersion === 'v1' && value.kind === 'Secret') {
    value = serializeSecret(value);
  }

  return value;
}

export function stringify(value: any, options: YAMLOptions = DEFAULT_OPTIONS): string {
  if (value.apiVersion === 'v1' && value.kind === 'Secret') {
    value = deserializeSecret(value, options);
  }

  return YAML.stringify(value, {
    version: '1.1',
    indentSeq: false,
    simpleKeys: true,
  });
}

function serializeSecret(obj: any) {
  if (obj._decodedData) {
    if (!obj.data) {
      obj.data = {};
    }

    for (let [k, v] of Object.entries(obj._decodedData)) {
      if (!obj.data[k]) {
        obj.data[k] = b64encode(v as string);
      }
    }
  }

  return obj;
}

function deserializeSecret(obj: any, {decodeSecrets}: YAMLOptions) {
  if (decodeSecrets) {
    let data: any = {};
    let decoded: any = {};
    for (let [k, v] of Object.entries(obj.data)) {
      let d = b64decode(v as string);
      if (isPrintable(d)) {
        decoded[k] = d;
      } else {
        data[k] = v as string;
      }
    }
    obj = {...obj};
    delete obj.data;
    if (Object.keys(data).length) {
      obj.data = data;
    }
    if (Object.keys(decoded).length) {
      obj._decodedData = decoded;
    }
  }

  return obj;
}

function b64encode(v: string): string {
  return Buffer.from(v).toString('base64');
}

function b64decode(v: string): string {
  return Buffer.from(v, 'base64').toString();
}

function isPrintable(v: string): boolean {
  return !/[\x00-\x08\x0E-\x1F\x7F]/.test(v);
}
