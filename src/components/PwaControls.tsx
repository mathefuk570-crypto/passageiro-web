import {useEffect,useState} from 'react';
type InstallEvent = Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
export default function PwaControls(){
 const [install,setInstall]=useState<InstallEvent|null>(null);
 const [waiting,setWaiting]=useState<ServiceWorker|null>(null);
 const [offline,setOffline]=useState(!navigator.onLine);
 const [dismissed,setDismissed]=useState(false);
 const [iosHelp,setIosHelp]=useState(false);
 const standalone=matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & {standalone?:boolean}).standalone);
 const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
 useEffect(()=>{
  const capture=(e:Event)=>{e.preventDefault();setInstall(e as InstallEvent)};
  const online=()=>setOffline(false), offline=()=>setOffline(true),installed=()=>setInstall(null);
  window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',installed);window.addEventListener('online',online);window.addEventListener('offline',offline);
  if(import.meta.env.PROD && 'serviceWorker' in navigator){
   void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(reg=>{
    if(reg.waiting)setWaiting(reg.waiting);
    reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)setWaiting(reg.waiting);});});
   }).catch(console.error);
  }
  return()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',installed);window.removeEventListener('online',online);window.removeEventListener('offline',offline)};
 },[]);
 return <>{offline&&<div role="alert" className="fixed top-0 inset-x-0 z-[300] bg-amber-300 p-3 text-center text-sm font-bold text-black">Sem conexão. Reconecte para atualizar sua corrida.</div>}
 {waiting&&!dismissed&&<div className="fixed top-3 inset-x-3 z-[250] mx-auto max-w-sm rounded-xl bg-tum-yellow p-4 text-black shadow-xl"><p className="text-sm">Nova versão disponível. Atualize quando não estiver solicitando ou acompanhando uma corrida.</p><button className="mt-2 font-black" onClick={()=>{navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});waiting.postMessage({type:'SKIP_WAITING'});}}>Atualizar agora</button><button className="ml-5 text-sm" onClick={()=>setDismissed(true)}>Depois</button></div>}
 {!standalone&&(install||ios)&&!dismissed&&!waiting&&<div className="fixed top-3 right-3 z-[90] max-w-xs rounded-xl border border-white/20 bg-black p-3 text-white shadow-xl"><button className="text-xs font-bold text-yellow-300" onClick={async()=>{if(install){await install.prompt();await install.userChoice;setInstall(null);}else setIosHelp(!iosHelp);}}>Instalar o TUM</button><button aria-label="Fechar instalação" className="ml-5" onClick={()=>setDismissed(true)}>×</button>{iosHelp&&<p className="mt-2 text-xs leading-5">No Safari, abra Compartilhar e escolha Adicionar à Tela de Início.</p>}</div>}</>;
}
