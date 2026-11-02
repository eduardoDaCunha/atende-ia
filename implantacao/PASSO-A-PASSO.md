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
```

## 7. Subir pela primeira vez

```bash
docker compose build
docker compose up -d postgres
# Cria as tabelas e define a senha do papel da aplicação:
docker compose run --rm app node dados/migrar.js
# Cria o primeiro administrador (mostra a senha provisória UMA vez):
docker compose run --rm -it app node setup-admin.js
# Sobe tudo:
docker compose up -d
docker compose logs -f app caddy     # Ctrl+C para sair dos logs
```

Abra `https://seudominio.com.br/acesso`, entre com o admin e troque a senha provisória.

**Trazer os dados do protótipo (opcional):** copie a pasta `data` do Windows para a VM (por exemplo com `scp`)
e rode a importação, que pode ser repetida sem duplicar nada:

```bash
docker compose run --rm -v /caminho/da/pasta/data:/importar:ro -e ATENDE_DATA_DIR=/importar app node dados/importar-json.js
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

## 9. WhatsApp

1. No painel do admin, cadastre a empresa do cliente e copie o ID dela para `WHATSAPP_EMPRESA_ID` no `.env`.
2. Na Meta (App > WhatsApp > Configuration): Callback URL `https://seudominio.com.br/webhook/whatsapp`,
   Verify token igual ao `WHATSAPP_VERIFY_TOKEN`, e assine o campo `messages`.
3. `docker compose up -d app` para aplicar o `.env`.
4. Configure o agente daquela empresa no painel (Personalização do agente > escolha a empresa).

Hoje cada instalação atende **um número de WhatsApp**. Vários clientes com números próprios exigem a próxima etapa
(mapear o `phone_number_id` de cada número para a empresa dele).

## 10. Atualizar para uma versão nova

```bash
cd ~/atende-ia && GIT_SSH_COMMAND="ssh -i ~/.ssh/atende_deploy" git pull
cd implantacao && sudo bash backup.sh
docker compose build app && docker compose run --rm app node dados/migrar.js && docker compose up -d app
```

As sessões ficam no banco: atualizar não desloga ninguém.

## Monitoramento mínimo

- Crie um monitor gratuito (ex.: UptimeRobot) para `https://seudominio.com.br/api/status`, com alerta por e-mail.
- `docker compose ps` mostra se tudo está de pé; `docker compose logs --since 1h app` mostra erros recentes.

## Quando sair do gratuito

Migre para uma VPS paga com a mesma pasta `implantacao/` (o processo é igual a partir da etapa 4) quando
acontecer qualquer um destes: banco perto de 10 GB, contrato com SLA, uso constante acima de 70% de CPU
ou a Oracle mudar as regras do plano gratuito.
