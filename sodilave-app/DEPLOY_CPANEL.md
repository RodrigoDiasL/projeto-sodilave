# Deploy da Sodilave WebApp em cPanel / CloudLinux

Este documento descreve o primeiro deploy da aplicação interna de produção. O domínio principal e `www.sodilave.pt` ficam reservados ao website institucional.

## Endereço da aplicação

Usar um subdomínio separado:

- `https://producao.sodilave.pt`

A aplicação Node.js deve ficar fora de `public_html`, por exemplo:

- repositório: `/home/sodilave/apps/projeto-sodilave`
- aplicação: `/home/sodilave/apps/projeto-sodilave/sodilave-app`
- logs: `/home/sodilave/logs`
- backups adicionais: `/home/sodilave/backups/producao-db`

## 1. Criar o subdomínio

No cPanel, abrir **Domains** e criar `producao.sodilave.pt`.

Não alterar o domínio principal nem `www.sodilave.pt`.

Confirmar que o SSL fica ativo para o novo subdomínio antes de usar a aplicação com dados reais.

## 2. Criar uma base de dados dedicada

No **Database Wizard**:

1. Criar uma base exclusiva para a aplicação.
2. Criar um utilizador MySQL exclusivo.
3. Gerar uma password longa e aleatória.
4. Dar a esse utilizador privilégios apenas sobre a base da aplicação.

Não usar a password da conta cPanel como credencial da aplicação.

Para alojamento partilhado, usar uma ligação com pool limitado:

```text
mysql://UTILIZADOR:SENHA@localhost:3306/BASE_DE_DADOS?connection_limit=5&pool_timeout=10&connect_timeout=10
```

Se a password tiver caracteres especiais, estes devem estar codificados no URL.

## 3. Colocar o código no servidor

Preferir **Git Version Control** do cPanel e clonar o repositório privado para:

```text
/home/sodilave/apps/projeto-sodilave
```

Para repositórios privados, usar uma chave SSH/deploy key. Não colocar um token GitHub diretamente no URL guardado no repositório.

## 4. Criar a aplicação Node.js

Em **Setup Node.js App**:

- Node.js version: `22.23.2`
- Application mode: `Production`
- Application root: `apps/projeto-sodilave/sodilave-app`
- Application URL: `producao.sodilave.pt`
- Application startup file: `app.js`
- Passenger log file: `/home/sodilave/logs/producao-passenger.log`

O cPanel/Passenger usa `app.js` como entry point. O ficheiro existente no projeto inicia o Next.js através de `server.cjs`.

## 5. Variáveis de ambiente

Adicionar no ecrã da aplicação Node.js:

```text
NODE_ENV=production
APP_URL=https://producao.sodilave.pt
APP_VERSION=0.9.8
DATABASE_URL=mysql://UTILIZADOR:SENHA@localhost:3306/BASE_DE_DADOS?connection_limit=5&pool_timeout=10&connect_timeout=10
SESSION_SECRET=CHAVE_ALEATORIA_LONGA
INITIAL_ADMIN_NAME=Rodrigo
INITIAL_ADMIN_PIN=PIN_DE_8_DIGITOS
BACKUP_DIR=/home/sodilave/backups/producao-db
BACKUP_RETENTION_DAYS=30
```

`SESSION_SECRET` deve ter no mínimo 32 caracteres e não deve ser uma frase previsível.

`INITIAL_ADMIN_PIN` só deve existir durante a preparação inicial da base de dados. Depois de criado o primeiro administrador, remover essa variável do cPanel.

Não definir manualmente `PORT`; o Passenger gere a ligação da aplicação.

## 6. Instalar e validar

Usar o Terminal do cPanel. O cPanel mostra o comando de ativação do ambiente Node da aplicação; ativá-lo antes dos comandos seguintes.

Como a aplicação está em modo `Production`, instalar explicitamente também as dependências de build. São necessárias para TypeScript e Prisma durante o deploy:

```bash
npm ci --include=dev
npm run verify:production
npm run db:production
npm run build:production
```

`db:production` já executa `prisma generate`, por isso não é necessário chamar `db:generate` separadamente.

### O que faz `db:production`

Na primeira instalação, numa base vazia:

1. confirma que a base está realmente vazia;
2. cria o schema Prisma principal;
3. cria uma tabela de controlo de migrações;
4. aplica todos os ficheiros SQL de `prisma/manual` pela ordem do nome;
5. guarda o checksum de cada migração;
6. cria o primeiro administrador se ainda não existir qualquer utilizador.

Se a base tiver tabelas que não correspondam ao schema esperado da Sodilave, a instalação é interrompida em vez de tentar alterar uma base desconhecida.

Em execuções posteriores não volta a executar `prisma db push` sobre uma base de produção existente. As migrações manuais já aplicadas são verificadas pelo checksum.

Nunca executar `npm run db:seed` na base de produção. O seed é apenas para desenvolvimento/testes e altera os PINs dos utilizadores conhecidos.

Qualquer futura alteração estrutural à base de produção deve ser acrescentada como nova migração SQL em `prisma/manual`; não alterar retroativamente ficheiros já aplicados.

## 7. Remover o PIN inicial

Depois de `npm run db:production` terminar com sucesso:

1. remover `INITIAL_ADMIN_PIN` das variáveis da aplicação;
2. opcionalmente remover também `INITIAL_ADMIN_NAME`;
3. reiniciar a aplicação.

## 8. Reiniciar o Passenger

Pode usar o botão **Restart** em Setup Node.js App.

Também é possível criar o ficheiro de restart:

```bash
mkdir -p tmp
touch tmp/restart.txt
```

Fazer isto sempre depois de um novo build ou alteração de variáveis de ambiente.

## 9. Teste de saúde

Abrir:

```text
https://producao.sodilave.pt/api/health
```

Resposta normal:

```json
{
  "status": "ok",
  "database": "ok"
}
```

Uma resposta HTTP 503 significa que a aplicação arrancou mas não consegue comunicar corretamente com a base de dados.

## 10. Testes antes de começar a produção real

Confirmar, por esta ordem:

1. login de administrador com PIN de 8 algarismos;
2. criação de um operador e rejeição de PIN duplicado;
3. criação/edição de máquinas e produtos;
4. associação produto-máquina;
5. criação de lotes comerciais e matérias-primas;
6. arranque semanal;
7. produção em rascunho;
8. reabertura do rascunho;
9. finalização com confirmação do segundo trabalhador;
10. desconto de stock;
11. correção administrativa da produção e reconciliação do stock;
12. cancelamento e reposição do stock;
13. verificações de turno e respetivo cancelamento auditável;
14. dashboard, scoreboards e uptime;
15. registo de avaria/paragem e alteração do estado da máquina;
16. `/api/health`.

Só depois destes testes devem ser introduzidos dados reais de produção.

## 11. Backups

O JetBackup do alojamento é a primeira camada de recuperação.

A aplicação inclui também:

```bash
npm run backup:db
```

O comando deteta `mysqldump` ou `mariadb-dump`, cria um dump comprimido em `.sql.gz` e elimina automaticamente backups mais antigos que `BACKUP_RETENTION_DAYS`.

Antes de automatizar o cron, executar manualmente `npm run backup:db` e confirmar que o ficheiro `.sql.gz` é criado e tem tamanho plausível.

Para o Cron Job, não colocar a password da base diretamente na linha de cron. Usar um ficheiro de ambiente privado fora da pasta pública ou o mecanismo de ambiente disponibilizado pelo alojamento.

## 12. Atualizações futuras

Antes de atualizar:

1. confirmar que o GitHub Actions está verde;
2. fazer backup da base de dados;
3. atualizar o repositório;
4. instalar as dependências de build;
5. executar as migrações;
6. criar novo build;
7. reiniciar Passenger;
8. confirmar `/api/health` e uma operação de leitura.

Exemplo:

```bash
git pull
npm ci --include=dev
npm run db:production
npm run build:production
mkdir -p tmp
touch tmp/restart.txt
```

## 13. Rollback

Se uma versão nova tiver problemas:

1. não apagar a base de dados;
2. identificar o último commit estável;
3. voltar o código para esse commit;
4. executar novamente `npm ci --include=dev` e `npm run build:production`;
5. reiniciar Passenger;
6. restaurar a base apenas se a atualização tiver alterado dados de forma incompatível e depois de confirmar o backup correto.

A restauração da base deve ser uma operação deliberada; não existe um comando automático de restore na aplicação para evitar substituições acidentais de dados reais.
