import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const html=readFileSync('dist/index.html','utf8');
const version=createHash('sha256').update(html).update(readFileSync('public/sw.js')).digest('hex').slice(0,12);
const shell=['/','/index.html','/offline.html','/icon-192.png','/icon-512.png','/tum-logo-login.png',...readdirSync('dist/assets').map(f=>'/assets/'+f)];
writeFileSync('dist/sw.js',`const CACHE='tum-pwa-${version}';\nconst SHELL=${JSON.stringify(shell)};\n`+readFileSync('public/sw.js','utf8'));
