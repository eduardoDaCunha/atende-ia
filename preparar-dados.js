/**
 * Prepara o armazenamento persistente do Atende.IA.
 * Nunca substitui um cadastro que ja existe. Nao exibe senhas nem hashes.
 * Uso: node preparar-dados.js [--check]
 */
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const readline=require('node:readline/promises');
const {stdin,stdout}=require('node:process');
const {DATA,ROOT}=require('./store');

const isJsonName=n=>/^[a-z0-9-]+\.json$/i.test(n);
async function exists(p){try{await fs.stat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function accounts(dir){
  const f=path.join(dir,'usuarios.json');
  if(!await exists(f))return null;
  const value=JSON.parse(await fs.readFile(f,'utf8'));
  if(!Array.isArray(value)||value.some(u=>!u||typeof u.username!=='string'||typeof u.hash!=='string'||typeof u.salt!=='string'||typeof u.id!=='string')) throw Error('O cadastro de usuarios nesta pasta nao e valido. Nenhum dado foi alterado.');
  return value;
}
async function migrate(source){
  if(path.resolve(source)===path.resolve(DATA))return;
  const users=await accounts(source);
  if(!users||users.length===0)throw Error('A origem escolhida nao possui usuarios.json com contas.');
  if(!users.some(u=>u.role==='admin'))throw Error('A origem nao possui conta administrativa. Verifique qual versao voce usava.');
  if(await accounts(DATA))throw Error('Ja existe usuarios.json na pasta permanente. Nenhum dado foi substituido.');
  if(await exists(DATA) && (await fs.readdir(DATA)).length)throw Error('A pasta permanente contem outros dados. Migração cancelada para evitar misturar cadastros.');
  const files=(await fs.readdir(source,{withFileTypes:true})).filter(f=>f.isFile()&&isJsonName(f.name)).map(f=>f.name);
  const staging=path.join(path.dirname(DATA),'data-importacao-'+process.pid);
  if(await exists(staging))throw Error('Diretorio temporario ja existe. Tente novamente depois.');
  await fs.mkdir(staging,{recursive:true,mode:0o700});
  let committed=false;
  try {
    for(const name of files)await fs.copyFile(path.join(source,name),path.join(staging,name),require('node:fs').constants.COPYFILE_EXCL);
    const oldCompany=path.join(path.dirname(source),'empresa.json');
    if(await exists(oldCompany)&&!files.includes('empresa.json')){
      JSON.parse(await fs.readFile(oldCompany,'utf8'));
      await fs.copyFile(oldCompany,path.join(staging,'empresa.json'),require('node:fs').constants.COPYFILE_EXCL);
    }
    if(!await accounts(staging))throw Error('Falha ao verificar cadastro importado.');
    await fs.mkdir(path.dirname(DATA),{recursive:true});
    if(await exists(DATA)){
      if((await fs.readdir(DATA)).length)throw Error('Pasta permanente foi preenchida durante a migracao. Nada substituido.');
      await fs.rmdir(DATA);
    }
    await fs.rename(staging,DATA);
    committed=true;
  } finally {if(!committed)await fs.rm(staging,{recursive:true,force:true});}
  console.log('\nDados importados com sucesso. Originais preservados em: '+source);
  console.log('Contas importadas: '+users.length+' (incluindo '+users.filter(u=>u.role==='admin').length+' administrador(es)).');
}
(async()=>{
  const check=process.argv.includes('--check');
  const firstSetup=process.argv.includes('--initial');
  const local=path.join(ROOT,'data');
  console.log('\n=== Atende.IA | Dados permanentes ===');
  console.log('Destino permanente: '+DATA);
  const current=await accounts(DATA);
  if(current){
    console.log('Cadastro permanente existente: '+current.length+' usuario(s); administradores: '+current.filter(u=>u.role==='admin').length+'.');
    if(!current.some(u=>u.role==='admin'))console.log('ATENCAO: nao ha administrador. Consulte o procedimento de recuperacao sem excluir dados.');
    console.log('Nenhuma alteracao realizada.');
    return;
  }
  const old=await accounts(local);
  if(check){
    if(old&&path.resolve(local)!==path.resolve(DATA))throw Error('Ha dados locais ainda nao importados. Execute PREPARAR-DADOS.bat antes de iniciar.');
    if(!firstSetup)throw Error('Nenhum cadastro permanente localizado. Execute PREPARAR-DADOS.bat e importe os usuarios antigos antes de iniciar.');
    console.log('Nenhum usuario anterior encontrado nesta pasta. Permitida somente a criacao inicial.');
    return;
  }
  let source=old?local:null;
  if(old)console.log('Encontrei cadastro na pasta da versao: '+local+' ('+old.length+' contas).');
  const rl=readline.createInterface({input:stdin,output:stdout});
  try{
    if(!source){
      console.log('Nao encontrei cadastro nesta versao. Sua conta pode estar na pasta data de uma versao anterior.');
      console.log('No Explorador, localize a pasta "data" que contem o arquivo "usuarios.json".');
      const val=(await rl.question('Cole o caminho COMPLETO da pasta data antiga (Enter cancela): ')).trim().replace(/^"|"$/g,'');
      if(!val){console.log('Nenhum arquivo modificado.');return;}
      source=val;
    }
    const found=await accounts(source);
    if(!found||!found.length)throw Error('Pasta nao contem cadastro de contas. Nada alterado.');
    console.log('Origem: '+source);
    console.log('Usuarios encontrados: '+found.length+'. A conta nao sera apagada nem substituida.');
    const confirmation=(await rl.question('Digite IMPORTAR para copiar esses dados ao local permanente: ')).trim();
    if(confirmation!=='IMPORTAR'){console.log('Cancelado.');return;}
    await migrate(source);
    console.log('A partir de agora, novas versoes que usam este armazenamento compartilham seus usuarios.');
  }finally{rl.close();}
})().catch(e=>{console.error('\nERRO: '+e.message);process.exitCode=1;});
