@echo off
REM Copie este arquivo para config-local.bat e preencha com o hostname do seu computador.
REM config-local.bat fica fora do Git: nao publique o endereco da sua tailnet.
REM Encontre o hostname com: tailscale status --self
set "TAILSCALE_HOST=SEU-COMPUTADOR.SUA-TAILNET.ts.net"
