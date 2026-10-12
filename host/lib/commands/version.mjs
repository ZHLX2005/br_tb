// version:单点真相 = package.json。
import { Registry } from '../registry.mjs';
import { VERSION } from '../version.mjs';

function Version() {
  return { status: 'ok', data: { version: VERSION, node: process.version, platform: process.platform } };
}

Registry.register('version', Version);
