import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));

export function loadAdminPassword(root){
 const runtime=path.join(root,'.sites-runtime');
 mkdirSync(runtime,{recursive:true,mode:0o700});
 const passwordPath=path.join(runtime,'admin-password.txt');
 try{writeFileSync(passwordPath,randomBytes(32).toString('base64url')+'\n',{flag:'wx',mode:0o600});}
 catch(error){if(error.code!=='EEXIST')throw error;}
 const password=readFileSync(passwordPath,'utf8').trim();
 if(password.length<20||password.length>512||/[\r\n]/u.test(password))throw new Error('Файл пароля администратора повреждён. Восстановите .sites-runtime/admin-password.txt или удалите его при остановленном сайте для создания нового пароля.');
 return {password,passwordPath,runtime};
}

/** @param {{SUPPORT_DEMO_MODE?: string}} parent */
export function runtimeDemoMode(parent=process.env){return parent.SUPPORT_DEMO_MODE?.trim().toLowerCase()!=='false';}

/** @param {string} root @param {{SUPPORT_DEMO_MODE?: string}} parent */
export function loadRuntimeConfiguration(root,parent=process.env){
 const publicDemo=runtimeDemoMode(parent);
 const runtime=path.join(root,'.sites-runtime');
 mkdirSync(runtime,{recursive:true,mode:0o700});
 return publicDemo?{publicDemo,runtime,password:undefined,passwordPath:undefined}:{publicDemo,...loadAdminPassword(root)};
}

export function runtimeEnvironment(parent,password,publicDemo=runtimeDemoMode(parent)){
 const env={...parent,SUPPORT_DEMO_MODE:String(publicDemo),AI_REVIEW_ENABLED:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'true'};
 if(publicDemo)delete env.SUPPORT_ADMIN_PASSWORD;
 else env.SUPPORT_ADMIN_PASSWORD=password;
 delete env.OPENAI_API_KEY;
 return env;
}

// Keep a suffix between chunks so even a split secret cannot reach a terminal/log.
export function redactOutput(secret,write){
 if(!secret)return {chunk:value=>write(String(value)),end:()=>{}};
 let pending='';
 return {
  chunk(value){
   pending+=value;
   let index;
   while((index=pending.indexOf(secret))!==-1){write(pending.slice(0,index)+'[hidden]');pending=pending.slice(index+secret.length);}
   const safe=Math.max(0,pending.length-secret.length+1);
   if(safe){write(pending.slice(0,safe));pending=pending.slice(safe);}
  },
  end(){write(pending.split(secret).join('[hidden]'));pending='';},
 };
}

export async function startLocal(root=projectRoot,args=process.argv.slice(2)){
 const {password,passwordPath,runtime,publicDemo}=loadRuntimeConfiguration(root);
 // Explicit empty env file skips legacy .dev.vars files; secrets come from this process only.
 const envFile=path.join(runtime,'runtime-empty.env');
 writeFileSync(envFile,'',{mode:0o600});
 const child=spawn(process.execPath,[
  '--import',pathToFileURL(path.join(root,'scripts','sites-env.mjs')).href,
  path.join(root,'node_modules','wrangler','bin','wrangler.js'),
  'dev','--config',path.join(root,'dist','server','wrangler.json'),
  '--local','--persist-to',path.join(root,'.wrangler','state'),'--ip','127.0.0.1','--inspector-port','0',
  ...args,'--env-file',envFile,
 ],{cwd:root,env:runtimeEnvironment(process.env,password,publicDemo),stdio:['inherit','pipe','pipe'],windowsHide:true});
 process.stdout.write(publicDemo?'Режим обработки: алгоритмы. Администратор доступен без пароля.\n':`Режим обработки: алгоритмы. Файл пароля администратора: ${passwordPath}\n`);
 const stdout=redactOutput(password,text=>process.stdout.write(text));
 const stderr=redactOutput(password,text=>process.stderr.write(text));
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',value=>stdout.chunk(value));child.stderr.on('data',value=>stderr.chunk(value));
 const stop=()=>{
  if(!child.pid)return;
  if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
  else child.kill('SIGTERM');
 };
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 return await new Promise((resolve,reject)=>{
  child.once('error',reject);
  child.once('close',code=>{
   stdout.end();stderr.end();
   process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
   resolve(code??0);
  });
 });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=await startLocal();}
 catch(error){process.stderr.write(`Не удалось запустить сайт: ${error.message}\n`);process.exitCode=1;}
}
