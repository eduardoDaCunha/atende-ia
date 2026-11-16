# Atende.IA — colocar no ar (Oracle Cloud Always Free)

Uma VM gratuita roda tudo: PostgreSQL, o servidor do Atende.IA e o Caddy (HTTPS automático).
Tempo estimado: 1 a 2 horas na primeira vez.

```
Internet ──443──> Caddy ──> 127.0.0.1:3011  site e painel
                        └─> 127.0.0.1:3012  /webhook/whatsapp (só esta rota)
                 Servidor ──> 127.0.0.1:5432  PostgreSQL (nunca exposto)
```

## O que você precisa ter antes

- Conta na Oracle Cloud (pede cartão para verificação; o Always Free não cobra dentro dos limites).
- Um domínio (ex.: registro.br) com acesso ao DNS.
- O código no GitHub, na versão aprovada para produção (branch `main` depois do merge).
- Chave do Gemini **num projeto com faturamento ativado** (no gratuito, o Google pode usar as conversas).

## 1. Criar a VM

1. Console da Oracle > **Compute > Instances > Create instance**.
2. Imagem: **Ubuntu 24.04**. Forma: **VM.Standard.A1.Flex** (ARM), **2 OCPU e 12 GB** (o máximo gratuito desde 2026).
   - Se aparecer "Out of host capacity", tente outro *Availability Domain* ou repita mais tarde.
3. Em *Add SSH keys*, envie sua chave pública (ou gere uma ali e **guarde a privada**).
4. Depois de criada, anote o **IP público**.
5. Recomendado: **Billing > Upgrade to Pay As You Go**. Continua sem custo dentro dos limites gratuitos
   e evita que a Oracle recupere a VM por "baixa utilização".

## 2. Abrir as portas 80 e 443

Na Oracle há dois bloqueios: o da rede (VCN) e o firewall do próprio Ubuntu.

1. **Networking > Virtual Cloud Networks >** sua VCN **> Security Lists > Default** > *Add Ingress Rules*:
   origem `0.0.0.0/0`, TCP, portas `80` e `443`.
2. No Ubuntu (via SSH):
   ```bash
   ssh ubuntu@IP_PUBLICO
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
3. Opcional e recomendado: instale o Tailscale na VM (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`)
   e depois remova a regra da porta 22 da Security List. Assim, o SSH só funciona pela sua rede Tailscale.

## 3. Apontar o domínio

No painel DNS do domínio, crie:

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` | IP público da VM |
| A | `www` | IP público da VM |

Pode levar de minutos a algumas horas para propagar. Confira com `nslookup seudominio.com.br`.

## 4. Instalar o Docker

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # saia e entre de novo no SSH
```

## 5. Baixar o código

Use uma *deploy key* (somente leitura) do GitHub:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/atende_deploy -N ""
cat ~/.ssh/atende_deploy.pub
```

Cole a chave em **GitHub > repositório > Settings > Deploy keys > Add** (sem marcar escrita). Depois:

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/atende_deploy" git clone git@github.com:eduardoDaCunha/atende-ia.git
cd atende-ia/implantacao
```

## 6. Configurar

```bash
cp .env.exemplo .env
nano .env        # preencha domínio, senhas e chaves (instruções dentro do arquivo)
chmod 600 .env
# Gera o .env.app, que é o que o app recebe: o .env SEM as senhas do dono do banco e sem o que é
# só do Compose/Caddy/backup. Não mostra nenhum valor na tela.
grep -vE '^(DATABASE_URL_DONO|POSTGRES_PASSWORD|ATENDE_APP_SENHA|RCLONE_[A-Z_]*|DOMINIO)=' .env > .env.app && chmod 600 .env.app
# Confere só os NOMES (não podem aparecer DATABASE_URL_DONO, POSTGRES_PASSWORD nem ATENDE_APP_SENHA):
grep -oE '^[A-Z_]+=' .env.app
```

**Sempre que mudar o `.env`, gere o `.env.app` de novo** (as duas linhas `grep` acima) e depois rode
`docker compose up -d app`. Escreva o `.env` no formato `NOME=valor`, uma variável por linha, sem `export`
nem espaço antes do nome: outro formato escapa do filtro (por isso a conferência dos nomes).

O `.env` completo (com o dono do banco) fica só para o Compose, o Caddy, o `backup.sh` e o serviço
`ferramentas`, usado só para comandos pontuais: migrar, importar e manutenção.

## 7. Subir pela primeira vez

```bash
docker compose build
docker compose up -d postgres
# Cria as tabelas e define a senha do papel da aplicação (precisa do dono do banco):
docker compose run --rm ferramentas node dados/migrar.js
# Cria o primeiro administrador (mostra a senha provisória UMA vez):
docker compose run --rm -it app node setup-admin.js
# Sobe tudo:
docker compose up -d
docker compose logs -f app caddy     # Ctrl+C para sair dos logs
```

Abra `https://seudominio.com.br/acesso`, entre com o admin, troque a senha provisória e ative a **verificação em duas etapas**
(o painel pede; use Google Authenticator ou similar e guarde a chave). Celular perdido: `docker compose run --rm -it app node recuperar-admin.js`.

**Trazer os dados do protótipo (opcional):** copie a pasta `data` do Windows para a VM (por exemplo com `scp`)
e rode a importação, que pode ser repetida sem duplicar nada:

```bash
docker compose run --rm -v /caminho/da/pasta/data:/importar:ro -e ATENDE_DATA_DIR=/importar ferramentas node dados/importar-json.js
```

## 8. Backup diário

```bash
sudo crontab -e
# acrescente a linha (todo dia às 03:17, horário da VM):
17 3 * * * cd /home/ubuntu/atende-ia/implantacao && bash backup.sh >> /var/log/atende-backup.log 2>&1
```

Teste agora com `sudo bash backup.sh`. **Guarde uma cópia fora da VM**: instale o `rclone`, configure um destino
(por exemplo um bucket gratuito do Cloudflare R2) e coloque `RCLONE_DESTINO=nome-do-remoto:pasta` no `.env`.
Para restaurar: `sudo bash restaurar.sh /var/backups/atende/ARQUIVO.dump`. Faça um teste de restauração antes
de receber o primeiro cliente.

**A senha e o sal do `crypt` do rclone ficam só no seu gerenciador de senhas.** Sem eles, nem você lê as cópias
externas: perder a VM e o gerenciador ao mesmo tempo é perder os backups.

### Regras de retenção

- Na VM: as cópias do banco ficam **14 dias** (`/var/backups/atende`); os logs do Docker, no máximo 5 arquivos de 10 MB por serviço.
- Fora da VM: as cópias do banco e os logs ficam **90 dias**. A poda roda no fim do `backup.sh` e:
  - só roda se a cópia externa **daquela execução** deu certo;
  - só apaga nomes com o padrão esperado (`atende-*.dump` na pasta do `RCLONE_DESTINO`, sem descer para subpastas,
    e `AAAA-MM-DD/HH.log.gz` dentro da pasta de logs), nunca a raiz inteira;
  - **não poda o banco** se houver 7 cópias ou menos no destino, nem se a poda deixaria menos de 7;
  - registra só números no `/var/log/atende-backup.log`; uma falha vira `AVISO:` e não interrompe o backup.

### Antes de ligar a poda: Backblaze (no painel, uma vez só)

Faça isto **antes** do primeiro `backup.sh` com a versão que tem a poda:

1. **Object Lock** (impede que um invasor com acesso à VM apague as cópias com a chave do rclone):
   Backblaze > *Buckets* > `atende-backups-...` > *Object Lock* > ativar, com **retenção padrão de 90 dias** e modo
   **Governance**. **Nunca use o modo Compliance**: nele, nem você nem o suporte da Backblaze conseguem apagar ou
   encurtar a retenção, e um erro de configuração fica pago até o fim do prazo.
   A chave do rclone que fica na VM **não** pode ter a permissão `bypassGovernance` (as chaves comuns de leitura e
   escrita não têm). Com o Object Lock, um arquivo só pode ser apagado depois dos 90 dias, o que casa com a poda.
2. **Lifecycle Settings**: troque "Keep all versions" por **"Keep only the last version of the file"**. Com "Keep all
   versions", o `rclone delete` só esconde o arquivo e ele continua guardado (e cobrado).
3. Teste a poda sem apagar nada e confira a linha `Poda (...) seriam removido(s)` no fim:
   ```bash
   ATENDE_PODA_TESTE=1 sudo -E bash backup.sh
   # ou à mão, só listando (troque b2cripto:banco pelo seu RCLONE_DESTINO):
   sudo rclone delete --dry-run --max-depth 1 --min-age 90d --include 'atende-*.dump' b2cripto:banco
   sudo rclone delete --dry-run --min-age 90d --include '/????-??-??/??.log.gz' b2cripto:logs
   ```
4. Um ou dois dias depois da primeira poda real (a Backblaze apaga os arquivos escondidos uma vez por dia):
   `sudo rclone ls b2cripto:` não deve listar nada com mais de 90 dias, e `sudo rclone ls --b2-versions b2cripto:`
   não deve mostrar versões antigas. Com o `crypt` por cima, o `--b2-versions` pode não decifrar os nomes e não
   listar nada; nesse caso confira pelo remoto B2 cru (`sudo rclone ls --b2-versions NOME-DO-REMOTO-B2:atende-backups-...`):
   os nomes aparecem embaralhados, mas dá para contar.

### Logs fora da VM

O `logs-fora.sh` envia, de hora em hora, os logs da hora anterior (app, Caddy, `/var/log/auth.log` e as linhas novas
do log do backup) para `<remoto>:logs/AAAA-MM-DD/HH.log.gz` (hora em UTC), criptografados pelo `crypt`. O remoto é o
mesmo do `RCLONE_DESTINO`; para outro lugar, defina `RCLONE_LOGS=remoto:pasta` no `.env` (fica fora do `.env.app`).
Ele nunca mostra o conteúdo dos logs: escreve uma linha por execução (`Logs fora ok` ou `AVISO:`). Se o envio falhar,
o arquivo fica em `/var/lib/atende-logs/pendente` e vai na execução seguinte.

```bash
sudo bash logs-fora.sh          # teste: deve terminar com "Logs fora ok: 1 arquivo(s) enviado(s)."
sudo crontab -e
# acrescente a linha (aos 5 minutos de cada hora):
5 * * * * cd /home/ubuntu/atende-ia/implantacao && bash logs-fora.sh >> /var/log/atende-logs-fora.log 2>&1
```

Conferir e ler:

```bash
sudo rclone ls b2cripto:logs/
sudo rclone cat b2cripto:logs/2026-11-14/10.log.gz | zcat | less
tail /var/log/atende-logs-fora.log     # só linhas de ok ou AVISO
```

## 9. WhatsApp

1. No painel do admin, cadastre a empresa do cliente e copie o ID dela para `WHATSAPP_EMPRESA_ID` no `.env`.
2. Na Meta (App > WhatsApp > Configuration): Callback URL `https://seudominio.com.br/webhook/whatsapp`,
   Verify token igual ao `WHATSAPP_VERIFY_TOKEN`, e assine o campo `messages`.
3. Gere o `.env.app` de novo (etapa 6) e rode `docker compose up -d app` para aplicar.
4. Configure o agente daquela empresa no painel (Personalização do agente > escolha a empresa).

Hoje cada instalação atende **um número de WhatsApp**. Vários clientes com números próprios exigem a próxima etapa
(mapear o `phone_number_id` de cada número para a empresa dele).

## 10. Atualizar para uma versão nova

```bash
cd ~/atende-ia && GIT_SSH_COMMAND="ssh -i ~/.ssh/atende_deploy" git pull
cd implantacao && sudo bash backup.sh
docker compose build app && docker compose run --rm ferramentas node dados/migrar.js && docker compose up -d app
```

As sessões ficam no banco: atualizar não desloga ninguém.

Quando a versão nova muda o `docker-compose.yml` (por exemplo, limites de memória ou de logs), aplique com
`sudo bash backup.sh` e depois `docker compose up -d`: o Compose recria os containers que mudaram. O PostgreSQL
volta em segundos e os dados ficam no volume.

### Uma vez só: VM instalada antes do `.env.app`

Se a VM foi instalada quando o app ainda recebia o `.env` inteiro, faça nesta ordem (o `.env.app` vem
**antes** do `git pull`: o `docker-compose.yml` novo não roda sem ele):

```bash
cd ~/atende-ia/implantacao && sudo bash backup.sh
# 1. Gera o .env.app e confere só os nomes (mesmas duas linhas da etapa 6):
grep -vE '^(DATABASE_URL_DONO|POSTGRES_PASSWORD|ATENDE_APP_SENHA|RCLONE_[A-Z_]*|DOMINIO)=' .env > .env.app && chmod 600 .env.app
grep -oE '^[A-Z_]+=' .env.app
# 2. Traz a versão nova e recria o app só com o .env.app:
cd ~/atende-ia && GIT_SSH_COMMAND="ssh -i ~/.ssh/atende_deploy" git pull
cd implantacao && docker compose up -d app
# 3. Confere: tem de mostrar 0 (só conta, não mostra valores).
docker compose exec app sh -c "env | grep -cE '^(DATABASE_URL_DONO|POSTGRES_PASSWORD|ATENDE_APP_SENHA)='"
# 4. Testa a manutenção pelo serviço ferramentas:
sudo bash backup.sh
```

Depois, abra `https://seudominio.com.br/api/status` e entre no painel. Para voltar atrás: no
`docker-compose.yml`, troque `env_file: .env.app` por `env_file: .env` e rode `docker compose up -d app`
(o `.env` não é alterado em nenhum momento).

## Monitoramento mínimo

- Crie um monitor gratuito (ex.: UptimeRobot) para `https://seudominio.com.br/api/status`, com alerta por e-mail.
- `docker compose ps` mostra se tudo está de pé; `docker compose logs --since 1h app` mostra erros recentes.
- `tail /var/log/atende-backup.log /var/log/atende-logs-fora.log`: procure linhas com `AVISO:`.

## Quando sair do gratuito

Migre para uma VPS paga com a mesma pasta `implantacao/` (o processo é igual a partir da etapa 4) quando
acontecer qualquer um destes: banco perto de 10 GB, contrato com SLA, uso constante acima de 70% de CPU
ou a Oracle mudar as regras do plano gratuito.
