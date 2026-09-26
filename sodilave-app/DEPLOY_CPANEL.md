# Deploy da aplicação Sodilave em cPanel / CloudLinux

Este guia corresponde à arquitetura sem ORM. A aplicação comunica diretamente com MariaDB/MySQL através de `mysql2/promise`.

## 0. Versão candidata e preparação do alojamento

A versão candidata está no ramo `refactor/remove-prisma`, incluindo encomendas,
entregas parciais e feedback dos registos. Instalar a revisão mais recente deste
ramo após o respetivo CI estar verde e registar o SHA instalado. A promoção para
`production` deve levar exatamente a revisão validada no alojamento.

Antes de executar comandos, confirmar no cPanel:

- Application root e versão Node atualmente configuradas;
- se há Terminal/SSH e repositório Git já associado;
- se a base do alojamento está vazia, tem dados de teste ou dados reais a preservar;
- certificado HTTPS e URL da aplicação.

Os caminhos `/home/sodilave/...` abaixo são exemplos; usar os caminhos que o
próprio cPanel apresenta para a conta. Não enviar passwords, PINs ou chaves em
capturas de ecrã. O código, ficheiros de ambiente e backups devem ficar fora da
pasta pública do website institucional.

Se existir uma instalação anterior, guardar uma cópia dos seus ficheiros e
configuração e exportar a base através de **Backup / phpMyAdmin** antes da alteração.
Durante a migração, impedir novas gravações/parar a aplicação no painel. Num
primeiro arranque, começar por uma base dedicada; não importar a base de testes
local sem decidir quais os dados que devem transitar.

## 1. Requisitos

- Node.js 22
- MariaDB/MySQL
- Passenger / Setup Node.js App
- HTTPS válido em `producao.sodilave.pt`
- Git disponível no cPanel

O website institucional `www.sodilave.pt` é independente desta aplicação.

## 2. Repositório

Exemplo de diretório:

```text
/home/sodilave/repos/projeto-sodilave
```

Aplicação:

```text
/home/sodilave/repos/projeto-sodilave/sodilave-app
```

Para esta primeira instalação, usar o ramo `refactor/remove-prisma`. As branches
`main` e `production` ainda não contêm esta versão. Não fazer `git pull` numa branch
antiga esperando obter automaticamente a refatoração.

Num clone existente, com cópias guardadas e a aplicação parada:

```bash
git status --short
git fetch origin
git switch refactor/remove-prisma
git pull --ff-only origin refactor/remove-prisma
git rev-parse HEAD
```

Se houver alterações locais ou qualquer comando falhar, resolver antes de avançar;
não usar `reset --hard` nem apagar configurações para forçar a atualização. Se não
houver Git no alojamento, descarregar o código desta revisão no GitHub e carregar
apenas os ficheiros da aplicação para uma pasta nova. Não carregar `node_modules`,
`.next` nem os ficheiros `.env` do computador de desenvolvimento.

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
TZ=Europe/Lisbon
APP_URL=https://producao.sodilave.pt
APP_VERSION=0.9.8
DATABASE_URL=mysql://...
SESSION_SECRET=...
NPM_CONFIG_INCLUDE=dev
BACKUP_DIR=/home/sodilave/backups/producao-db
BACKUP_RETENTION_DAYS=30
```

`SESSION_SECRET` deve ser aleatório, com pelo menos 32 caracteres. Para gerar uma
nova chave, no terminal privado do alojamento:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Guardar o resultado no ambiente da aplicação; não o enviar por mensagem. Manter a
chave existente numa atualização, salvo quando se pretende terminar as sessões.

`TZ=Europe/Lisbon` define a hora de operação (incluindo verão/inverno). As ligações
SQL da aplicação e das migrações fixam a sessão em UTC, independentemente do fuso
do MySQL partilhado. A opção não converte nem corrige datas históricas já gravadas.

Os comandos de Terminal também precisam da mesma configuração da aplicação.
Não presumir que as variáveis da interface Node.js são automaticamente exportadas
para o Terminal. Pode guardar a configuração em `.env.production` na pasta da
aplicação, com permissões `600`, a partir de `.env.production.example`. O Next.js e
os scripts de migração leem esse ficheiro; variáveis do processo têm prioridade.
Se a senha SQL contiver `@`, `:`, `/`, `#`, `%` ou outros caracteres reservados,
codificar esses caracteres no componente de senha da `DATABASE_URL`.

Não copiar `.env.local` de desenvolvimento: teria prioridade sobre
`.env.production` e poderia selecionar a base errada.

Na primeira preparação de uma base vazia também são necessários:

```text
INITIAL_ADMIN_NAME=Rodrigo
INITIAL_ADMIN_PIN=XXXXXXXX
```

O PIN tem exatamente 8 algarismos. Depois de o primeiro administrador ser criado, remover `INITIAL_ADMIN_PIN` do ambiente.

## 6. Instalar dependências

No painel Node.js, copiar a linha que o cPanel apresenta para ativar o ambiente
virtual da aplicação. Executá-la no **Terminal**, entrar na pasta `sodilave-app` e
confirmar:

```bash
node --version
export NODE_ENV=production
npm ci --include=dev
```

A versão deve ser `v22.x`. Os tipos/TypeScript são necessários ao build, mesmo em
modo Production. Preservar a ligação `node_modules` gerida pelo CloudLinux; não a
substituir por uma pasta copiada do Windows. Se apenas houver interface gráfica,
usar **Run NPM Install** com `NPM_CONFIG_INCLUDE=dev` e confirmar com o alojamento
como executar os scripts de migração/build.

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

Com a configuração validada e o backup concluído (se havia dados):

```bash
npm run db:production && npm run db:check
```

Confirmar no resultado o nome da base de dados pretendida. `db:check` tem de
terminar sem colunas em falta nem migrações pendentes. Não continuar para o
arranque se um destes passos falhar.

Este comando não depende de ferramentas externas de ORM. O script:

1. verifica se a base está vazia ou se já contém o schema Sodilave;
2. numa base vazia aplica `database/001-core.sql`;
3. cria a tabela `AppSchemaMigration`;
4. aplica por ordem as migrações de `database/migrations/`;
5. guarda o checksum de cada migração;
6. cria o administrador inicial apenas quando não existem utilizadores.

Esta versão inclui `2026-09-26-sales-orders.sql`, que cria `SalesOrder`,
`SalesOrderItem` e a ligação às saídas. As saídas anteriores mantêm-se no histórico;
as novas exigem selecionar uma encomenda previamente registada.

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
- encomenda com vários artigos e preços;
- saída ligada à encomenda, entrega parcial e consulta do histórico;
- mensagens verdes de sucesso e vermelhas de erro;
- verificações de turno;
- registo de incidente;
- manutenção;
- paragem semanal;
- dashboard e scoreboards;
- perfil Auditor sem permissões de escrita;
- `/api/health`.

Ensaiar operações que criam dados numa base de validação separada. Na base real,
confirmar login, perfis e consultas; registar apenas as operações reais da fábrica.
Não executar `npm run test:integration`, `npm run test:http` nem `db:seed` sobre a
base operacional: os testes SQL eliminam os dados da base descartável.

Confirmar também a hora/turno no dashboard, mapa de stock, ícones das sete máquinas,
ordens de paletização e emparelhamento de `/display`. Depois destes testes, a
revisão instalada pode ser promovida a `production` e usada nas próximas atualizações.

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
npm ci --include=dev
 ↓
backup da BD
 ↓
npm run db:production && npm run db:check
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


## 15. Falhas de instalação e recuperação

- `Unknown column` / `Table does not exist`: confirmar a base selecionada e concluir
  `db:production` + `db:check`. Não eliminar tabelas para contornar a verificação.
- Erro Passenger/503: consultar o log indicado no painel, confirmar `app.js`, Node
  22, build `.next/BUILD_ID` e as variáveis. Não usar `npm run dev` em produção.
- Formulários devolvem 403: `APP_URL` deve ser exatamente a origem HTTPS do navegador.
- `ENOMEM` / processo morto durante o build: consultar os limites de memória do
  alojamento. Não aumentar limites Node às cegas nem copiar módulos do Windows;
  combinar um build Linux compatível ou recursos adicionais com o fornecedor.
- Backup CLI indisponível: usar a exportação SQL do cPanel/phpMyAdmin antes de migrar.
- Se o deploy falhar, manter a aplicação parada enquanto se identifica a causa.
  As migrações SQL não têm reversão automática; não repor código antigo assumindo
  compatibilidade. Uma reposição completa exige ficheiros/configuração/base do
  mesmo ponto e uma decisão sobre quaisquer dados escritos depois do backup.

Referências da configuração do alojamento:
- https://docs.cloudlinux.com/cloudlinuxos/lve_manager/
- https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/
