import { createClient } from 'redis';
import { Chalk } from 'chalk';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();
global.redis = client;

const testLogger = Object.assign(new Chalk({ level: 3 }), {
  mark: console.log,
  debug: console.log,
  error: console.error,
  warn: console.warn,
  info: console.log
});
global.logger = testLogger;
global.Bot = { makeLog: console.log };
const YunzaiPlugin = (await import('./lib/plugins/plugin.js')).default;
global.plugin = YunzaiPlugin;

const { Panel } = await import('./plugins/ZZZ-Plugin/dist/apps/panel.js');
const { char } = await import('./plugins/ZZZ-Plugin/dist/lib/convert.js');
const { getPanelOrigin } = await import('./plugins/ZZZ-Plugin/dist/lib/avatar.js');

const uid = '17708598';
console.log('=== [1] Verifying Dynamic Resolution & Self-Healing for 菲欧妮 ===');
console.log('Before resolution, char.aliasToId("菲欧妮"):', char.aliasToId('菲欧妮'));

// Test getPanelOrigin with 菲欧妮
const originData = getPanelOrigin(uid, '菲欧妮');
console.log('getPanelOrigin result ID:', originData?.id, 'name:', originData?.name_mi18n);
console.log('After resolution, char.aliasToId("菲欧妮"):', char.aliasToId('菲欧妮'));
console.log('char.idToName(1641):', char.idToName(1641));

console.log('\n=== [2] Verifying #面板 菲欧妮 Command Flow ===');
const panel = new Panel();
const replies = [];
const renders = [];

const e = {
  user_id: '1904107636:F9F6331F761AE56AC1F49A8C197D1AFA',
  isZZZ: true,
  msg: '#面板 菲欧妮',
  reply: async (msg) => {
    replies.push(msg);
    return { message_id: 'mock_msg_001' };
  },
  runtime: {
    render: async (plugin, path, data, cfg) => {
      console.log('>>> [MOCK RENDER]: path =', path, 'data keys =', Object.keys(data || {}));
      return 'data:image/png;base64,mockImageBase64';
    },
    handler: {
      has: (k) => k === 'zzz.tool.panel',
      call: async (k, ev, data) => {
        console.log('Handler called for:', k, 'charId:', data?.data?.id, 'uid:', data?.uid);
        renders.push(data);
        return true;
      }
    }
  }
};
panel.e = e;
await panel.getCharPanel();
console.log('getCharPanel invoked successfully, handler calls:', renders.length);

console.log('\n=== [3] Verifying Unparameterized #更新面板 Warning & Confirmation Flow ===');
await client.del('ZZZ:PANEL:CONFIRM:' + uid);
const warnReplies = [];
panel.e = { ...e, msg: '#更新面板', reply: async (m) => { warnReplies.push(m); } };
await panel.handlePanelUpdate();
console.log('1st call output:\n', warnReplies[0]);
const confirmInRedis = await client.get('ZZZ:PANEL:CONFIRM:' + uid);
console.log('Confirmation key in Redis:', confirmInRedis);

console.log('\n=== [4] Verifying Single-Character #更新面板 艾莲 Flow ===');
const singleReplies = [];
panel.e = { ...e, msg: '#更新面板 艾莲', reply: async (m) => { singleReplies.push(m); } };
console.log('Calling panel.handlePanelUpdate() for single character 艾莲...');
await panel.handlePanelUpdate();
console.log('Single update finished.');

process.exit(0);
