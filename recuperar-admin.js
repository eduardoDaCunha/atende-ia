/** Recuperacao OFFLINE de senha administrativa. Exige acesso local aos arquivos.
 * Nao abre rotas web, nao exclui contas, gera backup antes de alterar a senha.
 * Mantenha TODOS os servidores Atende.IA desligados durante a operacao.
 */
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const readline=require('node:readline/promises');
const {stdin,stdout}=require('node:process');
const store=require('./store');
const {DATA}=store;
// No servidor (ATENDE_BANCO=postgres) a recuperação é feita no banco, sem arquivos nem cópia local.
const NO_BANCO=String(process.env.ATENDE_BANCO||'').toLowerCase()==='postgres';
const camada=NO_BANCO?require('./dados').dados():null;
const read=name=>NO_BANCO?camada.usuarios.listar():store.read(name);
const update=(name,mudar)=>NO_BANCO?camada.usuarios.atualizarLista(mudar):store.update(name,mudar);
const auth=require('./auth');
function portOpen(port){return new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});let done=false;const finish=v=>{if(!done){done=true;s.destroy();resolve(v);}};s.on('connect',()=>finish(true));s.on('error',()=>finish(false));s.setTimeout(800,()=>finish(false));});}
(async()=>{
  console.log('\n=== Atende.IA | Recuperar conta administrativa ===');
  console.log(NO_BANCO?'Dados: banco PostgreSQL':'Dados permanentes: '+DATA);
  if(await portOpen(3011))throw Error('O servidor da porta 3011 esta ligado. Encerre-o com Ctrl+C antes de continuar.');
  console.log('Confira se outros servidores do Atende.IA tambem estao desligados.');
  const file=path.join(DATA,auth.USERFILE);
  if(!NO_BANCO){
    let stat;try{stat=await fs.stat(file);}catch(e){if(e.code==='ENOENT')throw Error('Cadastro nao encontrado. Primeiro execute PREPARAR-DADOS.bat para importar sua pasta data antiga.');throw e;}
    if(!stat.isFile())throw Error('Arquivo de usuarios invalido.');
  }
  const all=await read(auth.USERFILE);
  if(!Array.isArray(all))throw Error('Cadastro de usuarios invalido.');
  const admins=all.filter(u=>u.role==='admin');
  if(!admins.length)throw Error('Nao ha administrador neste cadastro. Nao apague usuarios.json.');
  admins.forEach(u=>console.log(' - '+u.username+' ('+(u.active?'ativa':'inativa')+')'));
  const rl=readline.createInterface({input:stdin,output:stdout});
  try{
    const name=(await rl.question('Nome exato da conta administradora a recuperar: ')).trim().toLowerCase();
    const chosen=admins.find(u=>u.username===name);if(!chosen)throw Error('Nao encontrei essa conta administrativa.');
    const confirm=(await rl.question('Digite RECUPERAR para gerar uma senha provisoria: ')).trim();
    if(confirm!=='RECUPERAR'){console.log('Cancelado.');return;}
    if(await portOpen(3011))throw Error('Servidor voltou a ligar. Pare-o primeiro.');
    if(!NO_BANCO){
      const backups=path.join(DATA,'backups');await fs.mkdir(backups,{recursive:true});
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      await fs.copyFile(file,path.join(backups,'usuarios-antes-recuperacao-'+stamp+'.json'),require('node:fs').constants.COPYFILE_EXCL);
    }
    const password=auth.generatePassword();
    await update(auth.USERFILE,items=>{
      const target=items.find(u=>u.id===chosen.id&&u.role==='admin');
      if(!target)throw Error('A conta mudou durante a operacao. Nada alterado.');
      // Celular perdido também é motivo de recuperação: a verificação em duas etapas é desligada e precisa ser ativada de novo.
      Object.assign(target,auth.hashPassword(password),{active:true,mustChangePassword:true,mfaEnabled:false,mfaSecret:null,mfaPending:null});
    });
    if(NO_BANCO)await camada.auditoria.registrar('recuperacao_admin_offline','manutencao_local','Recuperacao offline: '+name);
    else await update('auditoria.json',events=>{events.push({at:new Date().toISOString(),action:'recuperacao_admin_offline',actor:'manutencao_local',detail:'Recuperacao offline: '+name});});
    console.log('\nSenha recuperada. O resto das contas foi preservado.');
    console.log('USUARIO: '+name);
    console.log('SENHA PROVISORIA: '+password);
    console.log('Nao compartilhe esta senha nem fotografe a tela.');
    console.log('Inicie o servidor e troque a senha provisoria ao entrar.');
  }finally{rl.close();if(camada)await camada.encerrar();}
})().catch(e=>{console.error('ERRO: '+e.message);process.exitCode=1;});
