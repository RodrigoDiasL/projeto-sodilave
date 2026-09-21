# Deploy da aplicação Sodilave em cPanel / CloudLinux

Este guia corresponde à arquitetura sem ORM. A aplicação comunica diretamente com MariaDB/MySQL através de `mysql2/promise`.

## 1. Requisitos

- Node.js 22
- MariaDB/MySQL
- Passenger / Setup Node.js App
- HTTPS válido em `producao.sodilave.pt`
- Git disponível no cPanel

O website institucional `www.sodilave.pt` é independente desta aplicação.

## 2. Repositório

Diretório utilizado:

```text
/home/sodilave/repos/projeto-sodilave
```

Aplicação:

```text
/home/sodilave/repos/projeto-sodilave/sodilave-app
```

Para produção definitiva, o servidor deve ficar na branch `production`. Durante testes desta refatoração pode ser usada a branch `refactor/remove-prisma`.

## 3. Base de dados

Criar no cPanel:

1. uma base MariaDB/MySQL dedicada;
2. um utilizador dedicado;
3. atribuir todos os privilégios desse utilizador apenas à base da aplicação.

A aplicação usa uma `DATABASE_URL` no formato:

```text
mysql://UTILIZADOR:SENHA@localhost:3306/BASE_DE_DADOS
```

A porta 3306 não deve ser exposta à Internet.

## 4. Aplicação Node.js

Em **Setup Node.js App**:

- Node.js: 22.x
- Application mode: Production
- Application root: `repos/projeto-sodilave/sodilave-app`
- Application URL: `producao.sodilave.pt`
- Startup file: `app.js`

## 5. Variáveis de ambiente

Configurar pelo menos:

```text
NODE_ENV=production
APP_URL=https://producao.sodilave.pt
APP_VERSION=0.9.8
DATABASE_URL=mysql://...
SESSION_SECRET=...
NPM_CONFIG_INCLUDE=dev
BACKUP_DIR=/home/sodilave/backups/producao-db
BACKUP_RETENTION_DAYS=30
```

`SESSION_SECRET` deve ter pelo menos 32 caracteres.

Na primeira preparação de uma base vazia também são necessários:

```text
INITIAL_ADMIN_NAME=Rodrigo
INITIAL_ADMIN_PIN=XXXXXXXX
```

O PIN tem exatamente 8 algarismos. Depois de o primeiro administrador ser criado, remover `INITIAL_ADMIN_PIN` do ambiente.

## 6. Instalar dependências

Executar **Run NPM Install** no cPanel.

A aplicação não executa qualquer geração de cliente ou motor nativo. A dependência de base de dados em runtime é `mysql2`.

## 7. Validar configuração

Executar:

```bash
npm run verify:production
```

A validação deve terminar com:

```text
Configuração de produção validada com sucesso.
```

## 8. Preparar a base de dados

Antes da primeira utilização:

```bash
npm run db:production
```

Este comando não depende de ferramentas externas de ORM. O script:

1. verifica se a base está vazia ou se já contém o schema Sodilave;
2. numa base vazia aplica `database/001-core.sql`;
3. cria a tabela `AppSchemaMigration`;
4. aplica por ordem as migrações de `database/migrations/`;
5. guarda o checksum de cada migração;
6. cria o administrador inicial apenas quando não existem utilizadores.

Se a base contiver tabelas mas não tiver a tabela `User`, o processo é interrompido por segurança.

Nunca alterar uma migração que já tenha sido aplicada em produção. Qualquer mudança estrutural futura deve ser um novo ficheiro numerado.

## 9. Typecheck e build

Executar:

```bash
npm run typecheck
npm run build
```

Ou, numa só sequência:

```bash
npm run build:production
```

O build já não executa ferramentas de base de dados; apenas TypeScript/Next.js.

## 10. Arrancar

No Setup Node.js App selecionar **Restart Application**.

O ficheiro `app.js` arranca o servidor definido em `server.cjs`.

Testar:

```text
https://producao.sodilave.pt/api/health
```

Resultado esperado:

```json
{"status":"ok","database":"ok"}
```

## 11. Testes mínimos antes de utilização real

Confirmar:

- login e logout;
- criação/edição de utilizadores;
- leitura do estado das máquinas;
- arranque semanal;
- produção em rascunho e finalização;
- consumo e reposição de stock;
- lote comercial;
- verificações de turno;
- registo de incidente;
- manutenção;
- paragem semanal;
- dashboard e scoreboards;
- perfil Auditor sem permissões de escrita;
- `/api/health`.

Antes destes testes, usar apenas dados de teste.

## 12. Backups

Teste manual:

```bash
npm run backup:db
```

Diretório recomendado:

```text
/home/sodilave/backups/producao-db
```

Depois configurar um Cron Job diário. Os backups devem também existir fora do próprio alojamento.

## 13. Atualizações futuras

Fluxo recomendado:

```text
dev
 ↓
typecheck / build / testes
 ↓
production
 ↓
git pull no cPanel
 ↓
npm install
 ↓
backup da BD
 ↓
npm run db:production
 ↓
npm run build:production
 ↓
Restart Application
 ↓
/api/health
```

## 14. Segurança

- HTTPS obrigatório.
- Não guardar `.env` no Git.
- Não reutilizar a password da base de dados noutros serviços.
- Remover `INITIAL_ADMIN_PIN` após a instalação inicial.
- Manter a base de dados acessível apenas localmente.
- Fazer backup antes de qualquer migração.
- Não executar o seed de desenvolvimento na base real.
