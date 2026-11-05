'use strict';
// Mock Kibana + 로그인 서버를 함께 실행 (Windows/Linux/macOS 공통). Ctrl+C 로 둘 다 종료.
const { spawn } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const procs = [
  spawn(process.execPath, [path.join(root, 'mock', 'kibana-mock.js')], { stdio: 'inherit', cwd: root }),
  spawn(process.execPath, [path.join(root, 'src', 'server.js')], { stdio: 'inherit', cwd: root }),
];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { console.error('프로세스 종료 code=' + code); stop(); } }));
