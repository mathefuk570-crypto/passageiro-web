const fs=require('fs'),path=require('path');
const p=path.join(process.cwd(),'android','app','src','main','AndroidManifest.xml');
if(!fs.existsSync(p)){console.error('[TUM] AndroidManifest.xml não encontrado:',p);process.exit(1)}
let x=fs.readFileSync(p,'utf8');if(!x.includes('xmlns:tools='))x=x.replace('<manifest ','<manifest xmlns:tools="http://schemas.android.com/tools" ');
const names=['android.permission.FOREGROUND_SERVICE_DATA_SYNC','android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK','android.permission.FOREGROUND_SERVICE_SPECIAL_USE','android.permission.READ_MEDIA_IMAGES','android.permission.READ_MEDIA_VIDEO','android.permission.READ_EXTERNAL_STORAGE','android.permission.WRITE_EXTERNAL_STORAGE'];
for(const n of names){const e=n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');x=x.replace(new RegExp(`\\s*<uses-permission[^>]*android:name=["']${e}["'][^>]*/>`,'g'),'')}
const r=names.map(n=>`  <uses-permission android:name="${n}" tools:node="remove" />`).join('\n');x=x.replace(/<application\b/,`${r}\n\n  <application`);fs.writeFileSync(p,x);console.log('[TUM] Manifest do Passageiro preparado.');
