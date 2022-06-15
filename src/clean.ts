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
	if ('default' in def && deepEqual(obj, def.default)) {
		throw DROP;
	}

	if ('$ref' in def) {
		let ref = def.$ref;
		if (ref === 'io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta') {
			if ('labels' in obj) {
				cleanLabels(obj.labels);
			}
			if ('annotations' in obj) {
				cleanAnnotations(obj.annotations);
			}
		}
		if (ref === 'io.k8s.apimachinery.pkg.apis.meta.v1.LabelSelector') {
			if ('matchLabels' in obj) {
				cleanLabels(obj.matchLabels);
			}
		}
		def = api.definitions[def.$ref];
		if (!def) {
			return;
		}
		if ('default' in def && deepEqual(obj, def.default)) {
			throw DROP;
		}
	}

	if (obj instanceof Array && 'items' in def) {
		for (let item of obj) {
			clean(item, def.items, api);
		}
	}

	if (isMapping(obj) && 'properties' in def) {
		for (let [k, v] of Object.entries(obj)) {
			let subdef = def.properties[k];
			if (!subdef) {
				continue;
			}
			try {
				if (subdef.readOnly && k !== 'readOnly') {
					throw DROP;
				}
				clean(v, subdef, api);
				if (isMapping(v) && Object.keys(v).length === 0) {
					throw DROP;
				}
			} catch (ex) {
				if (ex === DROP) {
					delete obj[k];
				}
			}
		}
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
	delete anns['kubectl.kubernetes.io/last-applied-configuration'];
	delete anns['deployment.kubernetes.io/revision'];
}

function isMapping(v: any): v is {[k: string]: any} {
	return typeof v === 'object' && !Array.isArray(v) && v !== null;
}
