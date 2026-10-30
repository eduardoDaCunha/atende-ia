# Atende.IA — preparação para publicação (v0.3.7)

## Para testes locais
1. Faça backup da pasta `data/` da versão que você está usando; guarde em local privado.
2. Extraia o ZIP v0.3.7 e copie `data/` para a nova pasta, caso deseje manter suas contas.
3. Rode `node scripts/verificar-imagens.js` para verificar WebP e imagens abaixo de 300 KB.
4. Rode `INICIAR-ATENDE.bat`. Abra `http://127.0.0.1:3009/` e `http://127.0.0.1:3009/privacidade`.
5. Inspecione a página em larguras 320, 360, 390, 768 e 1280 px. Teste Tab, Enter, Esc, contraste, zoom 200% e reduzir movimento.
6. Rode `node tests/smoke.js` e confira autenticação e permissões.

## Publicação — ainda bloqueada, requer mudanças adicionais
- Registrar domínio e escolher servidor/hospedagem compatível com Node.js 22+ e persistência confiável.
- Revisar autenticação, cookies com Secure em HTTPS, sessões persistentes, banco de dados, backup, MFA, monitoramento, segurança da API e isolamento entre empresas.
- Colocar reverse proxy com certificado TLS gerenciado, redirecionar HTTP para HTTPS e habilitar HSTS após validar HTTPS corretamente.
- Revisar política de privacidade com dados verdadeiros do controlador, canal de contato, bases legais, finalidade, fornecedores, retenção e direitos dos titulares.
- Conectar domínio ao host via DNS, verificar SSL e definir `SITE_ORIGIN=https://DOMINIO-REAL` APENAS após a aplicação estar segura e hospedada.
- Quando `SITE_ORIGIN` estiver configurado com HTTPS, as rotas `/robots.txt` e `/sitemap.xml` refletirão a URL real. Elas não geram visibilidade sem DNS, indexação e conteúdo útil.
- Inserir canonical real após domínio definido e cadastrar sitemap no Google Search Console e Bing Webmaster Tools.
- Nunca subir `data/`, segredos, tokens, arquivos JSON de clientes ou backups ao repositório público.

## SEO/GEO sem conteúdo genérico
- Descrever funções que existem de verdade; não prometer "atendimento 24/7" ou "aumento garantido das vendas" sem evidência.
- Documentar exemplos, limitações, fluxos de funcionamento e casos reais autorizados.
- Manter H1/H2 claros, conteúdo textual relevante, links internos e dados estruturados apenas com fatos verificáveis.
- Não depender de `llms.txt` ou arquivos mágicos para aparecer em respostas de IA.
- Manter URLs privadas não indexadas e autenticação no servidor.

## Dados e multimídia
- Todas as imagens de publicação em WebP, menores que 300 KiB individualmente, com dimensões apropriadas, alt quando informativas e lazy loading quando fora da tela.
- Preferir CSS e gráficos tipográficos em elementos decorativos, sem baixar bibliotecas de animação.
- `favicon.webp` é uma imagem real da marca, com cerca de 128 px. O SVG original pode ser guardado fora de `site/` para edição, mas não deve ser distribuído como imagem ao público se a política for somente WebP.

## Diagnóstico do site local
Com o servidor já iniciado em outra janela, execute `node scripts/testar-site.js` para conferir página, privacidade, WebP, gzip, ETag e proteção do painel.

## Regras editoriais obrigatórias
- Proibidos gradientes roxos, botões pílula, avaliações ou métricas inventadas, ícones emoji, travessões decorativos, fotos geradas por IA, efeitos de cursor, contadores falsos ou promessas sem evidência.
- Página inicial deve descrever capacidades presentes, não benefícios não comprovados.
- O favicon é o símbolo da marca em WebP, com tamanho inferior a 300 KB.
- Política de privacidade e Termos e condições devem permanecer acessíveis no rodapé. Os textos atuais são para testes, não são documentos jurídicos finais.
- **NÃO PUBLICAR** sem domínio próprio verificado, HTTPS funcional, hospedagem segura, revisão de autenticação, privacidade final e contratos definidos.
