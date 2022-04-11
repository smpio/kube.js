import API from './api';
import { Definition } from './interfaces';
import { deepEqual } from './util';

const DROP = Symbol('DROP');

export default function cleanObject(obj: any, api: API) {
	let resource = api.getResource(obj.apiVersion, obj.kind);
	if (!resource.definition) {
		throw new Error(`No definition for ${obj.apiVersion} ${obj.kind}`);
	}

	clean(obj, resource.definition, api);
}

function clean(obj: any, def: Definition, api: API) {
	if (def.type === 'ref') {
		let typeRef = def.$ref;

		if (typeRef === 'io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta') {
			if (obj.labels) {
				cleanLabels(obj.labels);
			}
			if (obj.annotations) {
				cleanAnnotations(obj.annotations);
			}
		}

		if (typeRef === 'io.k8s.apimachinery.pkg.apis.meta.v1.LabelSelector' && obj.matchLabels) {
			cleanLabels(obj.matchLabels);
		}

		def = api.definitions[def.$ref];
		if (!def) {
			return;
		}
	}

	if (def.type !== 'object') {
		return;
	}

	if ('default' in def && deepEqual(obj, def.default)) {
		return DROP;
	}

	for (let [k, v] of Object.entries(obj)) {
		let subdef = def.properties?.[k];
		if (!subdef) {
			continue;
		}

		if (subdef.readOnly) {
			delete obj[k];
			continue;
		}

		if ('default' in subdef) {
			if (typeof subdef.default === 'object') {
				if (deepEqual(v, subdef.default)) {
					delete obj[k];
					continue;
				}
			}
			else if (v === subdef.default) {
				delete obj[k];
				continue;
			}
		}

		if (v instanceof Array && subdef.type === 'array') {
			for (let item of v) {
				clean(item, subdef.items, api);
			}
		} else if (typeof v === 'object' && v) {
			if (clean(v, subdef, api) === DROP) {
				delete obj[k];
			}
		}
	}

	if (Object.entries(obj).length === 0) {
		return DROP;
	}
}

function cleanLabels(labels: any) {
	delete labels['controller-uid'];
	delete labels['job-name'];
	delete labels['pod-template-hash'];
}

function cleanAnnotations(anns: any) {
	delete anns['cni.projectcalico.org/containerID'];
	delete anns['cni.projectcalico.org/podIP'];
	delete anns['cni.projectcalico.org/podIPs'];
	delete anns['kubernetes.io/psp'];
}
