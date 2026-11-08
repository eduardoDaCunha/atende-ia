# Atende.IA: regras da equipe de agentes

Complementa o CLAUDE.md (que traz como executar, testar e a estrutura do projeto). Vale para TODOS os agentes. Leia antes de qualquer tarefa. O dono do projeto é o Eduardo; todo texto para o usuário em português do Brasil.

## Regras gerais (sem exceção)
1. NUNCA ler, imprimir, copiar ou alterar `.env`, `config-local.bat`, chaves SSH, tokens, senhas ou qualquer segredo. Se uma tarefa exigir um segredo, pare e avise.
2. NUNCA acessar o servidor de produção (ssh, docker no servidor) nem fazer deploy. Subir para produção é decisão do Eduardo.
3. Trabalhe só na SUA área (veja "Departamentos"). Se precisar mexer em arquivo de outra área, avise antes e espere.
4. Todos os agentes trabalham na MESMA pasta e na MESMA branch (`novas-funcoes`). NÃO troque de branch, NÃO faça commit, push, merge, reset ou checkout: quem faz o git é o Eduardo. Nunca mexa na `main`.
5. Antes de apagar arquivos, mudar dependências ou alterar o esquema do banco, peça confirmação. Mudança de esquema = novo arquivo em `dados/esquema/`.
6. Dados só pela camada `dados/`. Módulo novo usado pelo `server.js` entra SÓ em `tests/arquivos-servidor.js` (regra do CLAUDE.md).
7. Não invente dados, estatísticas, clientes ou depoimentos. Use só dados reais ou claramente fictícios.
8. Mostre o plano antes de editar. Ao final, rode os testes indicados no CLAUDE.md para os arquivos que você mudou.
9. Ao terminar, entregue um RESUMO curto: o que mudou, quais arquivos, como testar e o que ficou pendente.

## Segurança (todos, ao programar)
- Valide e limpe toda entrada do usuário (use `sanitizar.js`). Consultas parametrizadas no banco.
- Respeite o RLS: cada empresa vê só os próprios dados.
- Nunca registre em log senhas, tokens, números completos de telefone ou conteúdo de conversas.
- Respeite os limites de uso da IA já configurados.
- Mensagens de erro públicas não revelam detalhes internos.

## Fluxo de trabalho
Desenvolvimento constrói → Qualidade testa → Segurança revisa → Eduardo aprova → commit → deploy (feito pelo Eduardo).

## Departamentos e agentes

### Desenvolvimento, frente pública: agente "Atende.ia"
- Área: `site/publico` (página inicial e páginas de venda).
- Tarefa atual: seção "Experimente agora", chat de demonstração com empresa fictícia (ex.: uma clínica), reaproveitando a função de resposta existente (`resposta.js`, canal `site`) e respeitando `ATENDE_IA_LIMITE_SITE_DIA`.
- NÃO mexer em: `site/interno`, `dados/`.

### Desenvolvimento, painel e dados: agente "Jubileu"
- Área: `site/interno` (painel) e `dados/`.
- Tarefa atual: página "Dados da empresa" (horário, endereço, serviços, preços, perguntas frequentes), salva por empresa respeitando o RLS e usada pela IA nas respostas. Criar o novo arquivo de esquema em `dados/esquema/`.
- NÃO mexer em: `site/publico`.

### Ferramentas de venda, depois Qualidade e Segurança: agente "Barata Anatômica"
- Fase 1: página pública separada "/calculadora" (calculadora de perda de vendas, só com números que o visitante digitar). Arquivos novos; só adicione a rota necessária.
- Fase 2 (quando os outros dois terminarem): revisar o trabalho deles.
  - Qualidade: rodar `bash rodar-testes.sh`, procurar bugs, testar os fluxos novos.
  - Segurança: procurar falhas comuns (segredos expostos, injeção, falta de validação, falhas de RLS, logs com dado pessoal) e RELATAR. Em revisão, não corrigir sem aprovação.

## Departamentos futuros (sem agente)
- Infra: Docker, backup, monitoramento, servidor. Só o Eduardo supervisiona.
- Produto e Conteúdo: textos do site, planos, materiais de venda.
- Segurança (profissional humano): contratação futura. O agente de segurança NÃO substitui esse profissional.
