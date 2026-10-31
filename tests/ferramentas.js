'use strict';
// Núcleo de ferramentas: definição, validação, perfis, limite, auditoria sem conteúdo,
// limpeza de segredos e confirmação em duas etapas. Tudo com ferramentas e dados fictícios.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const {criarRegistro,definirFerramenta}=require(path.join(root,'ferramentas.js'));

const rejeita=async(promessa,status,codigo)=>{
  try{await promessa;}catch(err){assert.equal(err.status,status,`status esperado ${status}, veio ${err.status}: ${err.message}`);if(codigo)assert.equal(err.codigo,codigo);return err;}
  assert.fail(`Deveria falhar com ${status}`);
};

(async()=>{
  // ---------- definição ----------
  assert.throws(()=>definirFerramenta({nome:'X maiúsculo',nivel:'leitura',executar(){}}),/Nome/);
  assert.throws(()=>definirFerramenta({nome:'sem_nivel',nivel:'qualquer',executar(){}}),/Nível/);
  assert.throws(()=>definirFerramenta({nome:'acao_sem_previa',nivel:'acao',executar(){}}),/previa/);
  assert.throws(()=>definirFerramenta({nome:'perfil_ruim',nivel:'leitura',perfis:['dono'],executar(){}}),/Perfis/);
  assert.throws(()=>definirFerramenta({nome:'tipo_ruim',nivel:'leitura',entrada:{type:'object',properties:{a:{type:'array'}}},executar(){}}),/não suportado/);

  // ---------- registro com ferramentas fictícias ----------
  let relogio=Date.parse('2026-10-30T12:00:00Z');
  const segredoFicticio='EAAsegredo-'+crypto.randomBytes(8).toString('hex');
  const auditoria=[];
  const env={WHATSAPP_TOKEN:segredoFicticio,WHATSAPP_ALLOWED_NUMBERS:'5548999990001'};
  const registro=criarRegistro({agora:()=>relogio,env});
  let contador=0;
  registro.registrar({nome:'eco',nivel:'leitura',perfis:['admin','atendimento'],
    entrada:{type:'object',properties:{texto:{type:'string',maxLength:20},vezes:{type:'integer',minimum:1,maximum:3,default:1},modo:{type:'string',enum:['a','b']}},required:['texto']},
    executar:a=>({repetido:a.texto.repeat(a.vezes),modo:a.modo??null})});
  registro.registrar({nome:'vaza_segredo',nivel:'leitura',executar:()=>({token:segredoFicticio,telefone:'5548999990001',texto:'ok'})});
  registro.registrar({nome:'consulta_externa',nivel:'sensivel',limitePorMinuto:2,executar:()=>'feito'});
  registro.registrar({nome:'somar_contador',nivel:'acao',entrada:{type:'object',properties:{quanto:{type:'integer',minimum:1,maximum:5}},required:['quanto']},
    previa:a=>({vaiSomar:a.quanto,atual:contador}),executar:a=>({contador:contador+=a.quanto})});
  registro.registrar({nome:'quebra',nivel:'leitura',executar:()=>{throw new Error('falha interna fictícia');}});
  assert.throws(()=>registro.registrar({nome:'eco',nivel:'leitura',executar(){}}),/repetida/);

  const admin={usuario:{id:'1',username:'admin.teste',role:'admin'},origem:'painel',auditar:async(...a)=>auditoria.push(a)};
  const atend={usuario:{id:'2',username:'ana.teste',role:'atendimento'},origem:'painel',auditar:async(...a)=>auditoria.push(a)};
  const cliente={usuario:{id:'3',username:'cli.teste',role:'cliente'},origem:'painel'};
  const local={origem:'local'};

  // listar: só o que o perfil pode usar, com esquema
  assert.deepEqual(registro.listar(atend).map(f=>f.nome),['eco']);
  assert.equal(registro.listar(cliente).length,0);
  assert.equal(registro.listar({origem:'painel'}).length,0,'Sem usuário, nada');
  assert.equal(registro.listar(admin).length,5);
  assert.equal(registro.listar(local).length,5,'Local age como administrador');
  assert.equal(registro.listar(admin).find(f=>f.nome==='somar_contador').exigeConfirmacao,true);

  // permissão
  await rejeita(registro.executar('eco',{texto:'x'},{origem:'painel'}),401,'sem_login');
  await rejeita(registro.executar('eco',{texto:'x'},cliente),403,'sem_permissao');
  await rejeita(registro.executar('somar_contador',{quanto:1},atend),403,'sem_permissao');
  await rejeita(registro.executar('nao_existe',{},admin),404,'nao_encontrada');

  // validação
  assert.deepEqual((await registro.executar('eco',{texto:'ab',vezes:2},atend)).resultado,{repetido:'abab',modo:null});
  assert.deepEqual((await registro.executar('eco',{texto:'ab'},atend)).resultado.repetido,'ab','Valor padrão aplicado');
  await rejeita(registro.executar('eco',{},atend),400,'entrada_invalida');
  await rejeita(registro.executar('eco',{texto:5},atend),400);
  await rejeita(registro.executar('eco',{texto:'x'.repeat(21)},atend),400);
  await rejeita(registro.executar('eco',{texto:'a',vezes:4},atend),400);
  await rejeita(registro.executar('eco',{texto:'a',vezes:1.5},atend),400);
  await rejeita(registro.executar('eco',{texto:'a',modo:'c'},atend),400);
  await rejeita(registro.executar('eco',{texto:'a',extra:true},atend),400);
  await rejeita(registro.executar('eco',['a'],atend),400);

  // saída sem segredos
  const vazado=await registro.executar('vaza_segredo',{},admin);
  assert.equal(JSON.stringify(vazado).includes(segredoFicticio),false);
  assert.equal(JSON.stringify(vazado).includes('5548999990001'),false);
  assert.equal(vazado.resultado.token,'[oculto]');

  // auditoria: nome da ferramenta, ator e campos, nunca valores
  auditoria.length=0;
  await registro.executar('eco',{texto:'segredo-cliente'},atend);
  assert.deepEqual(auditoria[0].slice(0,2),['ferramenta_eco','ana.teste']);
  assert.match(auditoria[0][2],/^ok • campos: texto,vezes$/);
  assert.equal(JSON.stringify(auditoria).includes('segredo-cliente'),false);
  await rejeita(registro.executar('quebra',{},admin),undefined);
  assert.match(auditoria.at(-1)[2],/^falha/,'Falha também é auditada');

  // limite por minuto, por ferramenta e por pessoa
  await registro.executar('consulta_externa',{},admin);await registro.executar('consulta_externa',{},admin);
  await rejeita(registro.executar('consulta_externa',{},admin),429,'limite');
  relogio+=61_000;
  assert.equal((await registro.executar('consulta_externa',{},admin)).resultado,'feito','Libera após um minuto');

  // ---------- confirmação em duas etapas ----------
  const p=await registro.executar('somar_contador',{quanto:2},admin);
  assert.equal(p.requerConfirmacao,true);assert.deepEqual(p.previa,{vaiSomar:2,atual:0});
  assert.equal(contador,0,'Prévia não executa');
  const codigo=p.confirmacao.codigo;
  await rejeita(registro.executar('somar_contador',{quanto:3},admin,codigo),409,'confirmacao_invalida');   // outros argumentos
  await rejeita(registro.executar('somar_contador',{quanto:2},{...admin,usuario:{...admin.usuario,username:'outro.admin'}},codigo),409,'confirmacao_invalida'); // outro usuário
  await rejeita(registro.executar('somar_contador',{quanto:2},admin,'abc.def.ghi'),409,'confirmacao_invalida');
  await rejeita(registro.executar('somar_contador',{quanto:2},admin,codigo.slice(0,-2)+'xx'),409,'confirmacao_invalida');
  assert.equal(contador,0);
  assert.deepEqual((await registro.executar('somar_contador',{quanto:2},admin,codigo)).resultado,{contador:2});
  await rejeita(registro.executar('somar_contador',{quanto:2},admin,codigo),409,'confirmacao_usada');
  assert.equal(contador,2,'Código de uso único');
  const p2=await registro.executar('somar_contador',{quanto:1},admin);
  relogio+=5*60_000+1;
  await rejeita(registro.executar('somar_contador',{quanto:1},admin,p2.confirmacao.codigo),409,'confirmacao_expirada');
  const outroRegistro=criarRegistro({agora:()=>relogio,env});
  outroRegistro.registrar({nome:'somar_contador',nivel:'acao',previa:()=>0,executar:()=>0,entrada:{type:'object',properties:{quanto:{type:'integer'}}}});
  const p3=await registro.executar('somar_contador',{quanto:1},admin);
  await rejeita(outroRegistro.executar('somar_contador',{quanto:1},admin,p3.confirmacao.codigo),409,'confirmacao_invalida');
  assert.equal(contador,2);

  // ---------- catálogo real e linha de comando ----------
  const {criarCatalogo}=require(path.join(root,'catalogo.js'));
  const cat=criarCatalogo({env:{},fetch:async()=>{throw new Error('sem rede');}});
  assert.deepEqual(cat.nomes(),['diagnostico','diagnostico_testar_conexoes','estatisticas','listar_solicitacoes','ler_solicitacao','listar_conversas_whatsapp','ler_conversa_whatsapp','listar_empresas']);
  assert.deepEqual(cat.listar(atend).map(f=>f.nome),['estatisticas','listar_solicitacoes','listar_conversas_whatsapp'],'Atendimento: só listas e estatísticas');
  const diag=await cat.executar('diagnostico',{},admin);
  assert.equal(diag.resultado.esquema,1);
  const cli=spawnSync(process.execPath,[path.join(root,'catalogo.js'),'listar'],{encoding:'utf8',timeout:20000});
  assert.equal(cli.status,0);assert.equal(JSON.parse(cli.stdout).length,8);
  const cliErro=spawnSync(process.execPath,[path.join(root,'catalogo.js'),'executar','diagnostico','{"x":1}'],{encoding:'utf8',timeout:20000});
  assert.equal(cliErro.status,1);assert.match(cliErro.stderr,/entrada_invalida/);

  await rotas();
  console.log('OK: núcleo de ferramentas — perfis, validação, limite, auditoria sem conteúdo, saída sem segredos, confirmação de uso único, catálogo, CLI e rotas.');
})().catch(err=>{console.error('FALHA NO TESTE:',err);process.exitCode=1;});

/** /api/ferramentas no servidor real, com usuários fictícios. */
async function rotas(){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'atende-ferr-'));
  const data=path.join(base,'data');await fs.mkdir(data);
  for(const name of ['server.js','auth.js','store.js','resposta.js','whatsapp.js','conversas.js','diagnostico.js','sanitizar.js','ferramentas.js','catalogo.js','negocio.js','empresa.json'])await fs.copyFile(path.join(root,name),path.join(base,name));
  await fs.cp(path.join(root,'site'),path.join(base,'site'),{recursive:true});
  const {hashPassword}=require(path.join(base,'auth.js'));
  const pw='Senha-Ficticia-2026!',agora=new Date().toISOString(),empresa=crypto.randomUUID();
  await fs.writeFile(path.join(data,'empresas.json'),JSON.stringify([{id:empresa,name:'Empresa Fictícia',city:'Florianópolis',uf:'SC',timeZone:'America/Sao_Paulo',state:'ativa',createdAt:agora}]));
  const u=(username,role,companyId,mustChangePassword=false)=>({id:crypto.randomUUID(),username,name:username,role,companyId,active:true,mustChangePassword,createdAt:agora,...hashPassword(pw)});
  await fs.writeFile(path.join(data,'usuarios.json'),JSON.stringify([u('admin.teste','admin',null),u('ana.teste','atendimento',empresa),u('provisorio.teste','admin',null,true)]));
  const port=37000+Math.floor(Math.random()*1000),origin=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['server.js'],{cwd:base,stdio:'ignore',env:{...process.env,ATENDE_DATA_DIR:data,PORT:String(port),GEMINI_API_KEY:'',TAILSCALE_HOST:'',WHATSAPP_TOKEN:'',WHATSAPP_APP_SECRET:'',WHATSAPP_VERIFY_TOKEN:'',WHATSAPP_PHONE_NUMBER_ID:''}});
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const call=async(route,method='GET',body=null,s=null,csrf=true)=>{
    const headers={Origin:origin};if(s){headers.Cookie=s.cookie;if(csrf)headers['X-CSRF-Token']=s.csrf;}
    if(body!==null)headers['Content-Type']='application/json';
    const r=await fetch(origin+route,{method,headers,body:body!==null?JSON.stringify(body):undefined});
    return {status:r.status,data:await r.json().catch(()=>null),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    for(let i=0;i<80;i++){try{if((await call('/api/status')).status===200)break;}catch{}await wait(100);}
    const login=async n=>{const r=await call('/api/auth/login','POST',{username:n,password:pw});assert.equal(r.status,200);return {cookie:r.cookie,csrf:r.data.csrf};};
    const admin=await login('admin.teste'),ana=await login('ana.teste'),provisorio=await login('provisorio.teste');
    // Senha provisória: como nas demais rotas, nada de ferramentas antes de trocar a senha.
    assert.equal((await call('/api/ferramentas','GET',null,provisorio)).status,403,'Senha provisória não lista ferramentas');
    assert.equal((await call('/api/ferramentas/diagnostico','POST',{},provisorio)).status,403,'Senha provisória não executa ferramentas');
    assert.equal((await call('/api/admin/diagnostico','GET',null,provisorio)).status,403,'Senha provisória não lê o diagnóstico');
    assert.equal((await call('/api/admin/diagnostico','POST',{},provisorio)).status,403,'Senha provisória não testa conexões');
    assert.equal((await call('/api/ferramentas')).status,401);
    assert.deepEqual((await call('/api/ferramentas','GET',null,ana)).data.items.map(f=>f.nome),['estatisticas','listar_solicitacoes','listar_conversas_whatsapp'],'Atendimento não vê ferramentas de admin');
    assert.deepEqual((await call('/api/ferramentas','GET',null,admin)).data.items.map(f=>f.nome),['diagnostico','diagnostico_testar_conexoes','estatisticas','listar_solicitacoes','ler_solicitacao','listar_conversas_whatsapp','ler_conversa_whatsapp','listar_empresas']);
    assert.equal((await call('/api/ferramentas/diagnostico','POST',{})).status,401,'Sem login');
    assert.equal((await call('/api/ferramentas/diagnostico','POST',{},admin,false)).status,403,'Sem CSRF');
    assert.equal((await call('/api/ferramentas/diagnostico','POST',{},ana)).status,403,'Atendimento');
    assert.equal((await call('/api/ferramentas/nao_existe','POST',{},admin)).status,404);
    assert.equal((await call('/api/ferramentas/diagnostico','POST',{args:{x:1}},admin)).status,400);
    assert.equal((await call('/api/ferramentas/diagnostico','POST',{args:[1]},admin)).status,400);
    const r=await call('/api/ferramentas/diagnostico','POST',{},admin);
    assert.equal(r.status,200);assert.equal(r.data.ferramenta,'diagnostico');assert.equal(r.data.resultado.esquema,1);
    assert.equal(JSON.stringify(r.data).includes(data),false,'Sem caminho da pasta de dados');
    const aud=(await call('/api/admin/audit','GET',null,admin)).data.items.map(x=>x.action);
    assert.ok(aud.includes('ferramenta_diagnostico'),'Execução auditada');
  }finally{
    server.kill();await wait(300);await fs.rm(base,{recursive:true,force:true}).catch(()=>{});
  }
}
