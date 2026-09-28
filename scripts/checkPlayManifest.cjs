const fs=require('fs'),path=require('path');
const roots=[
 path.join(process.cwd(),'android','app','build','intermediates','merged_manifest','release'),
 path.join(process.cwd(),'android','app','build','intermediates','merged_manifests','release'),
];
function files(dir){if(!fs.existsSync(dir))return[];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const manifest=roots.flatMap(files).find(f=>f.endsWith('AndroidManifest.xml'));
if(!manifest){console.log('[TUM] Manifest merged de release ainda não existe. Faça o build e rode novamente.');process.exit(0)}
const xml=fs.readFileSync(manifest,'utf8');
const perms=[...xml.matchAll(/<uses-permission[^>]+android:name="([^"]+)"/g)].map(m=>m[1]).filter(x=>x.includes('FOREGROUND_SERVICE'));
console.log('[TUM] FGS no Passageiro merged:');[...new Set(perms)].sort().forEach(x=>console.log(' - '+x));
const unwanted=perms.filter(x=>/DATA_SYNC|MEDIA_PLAYBACK|SPECIAL_USE/.test(x));
if(unwanted.length){console.error('[TUM] ATENÇÃO: ainda há FGS indesejado:',[...new Set(unwanted)]);process.exitCode=2}else console.log('[TUM] OK: nenhum DATA_SYNC / MEDIA_PLAYBACK / SPECIAL_USE detectado.');
