import * as assert from 'assert';


export function deepEqual(obj1: any, obj2: any) {
  try {
    assert.deepStrictEqual(obj1, obj2);
    return true;
  } catch (err) {
    return false;
  }
}
