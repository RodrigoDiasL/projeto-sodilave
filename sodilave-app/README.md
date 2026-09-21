# Sodilave — Gestão de Produção

Aplicação interna de gestão operacional da Sodilave, construída com Next.js 15, TypeScript e MariaDB/MySQL. A aplicação usa SQL direto através de `mysql2/promise`; não depende de ORM.

## Ambiente de desenvolvimento

Requisitos:

- Node.js 22
- MariaDB/MySQL

Instalação local:

```bash
npm install
npm run db:production
npm run dev
```

Se a base de desenvolvimento estiver vazia, defina `INITIAL_ADMIN_NAME` e `INITIAL_ADMIN_PIN` antes de executar `db:production`.

O seed opcional de desenvolvimento usa igualmente SQL direto:

```bash
npm run db:seed
```

## PINs

A aplicação exige PINs de exatamente 8 algarismos e não permite PINs repetidos.

Existe um comando de recuperação administrativa:

```bash
RESET_USER_NAME="Nome" RESET_USER_PIN="12345678" npm run pins:reset
```

## Validação

Antes de qualquer deploy:

```bash
npm run typecheck
npm run build
```

Para validar a configuração completa de produção:

```bash
npm run verify:production
npm run build:production
```

## Produção

A aplicação interna deve ser publicada num endereço separado do website institucional.

- Website institucional: `www.sodilave.pt`
- Aplicação interna: `producao.sodilave.pt`

O alojamento de produção usa cPanel / CloudLinux / Passenger com Node.js 22.

As instruções completas estão em:

```text
DEPLOY_CPANEL.md
```

### Base de dados

A estrutura é mantida em SQL versionado:

```text
database/
├── 001-core.sql
└── migrations/
    ├── 2026-07-26-machine7-cavities.sql
    ├── 2026-07-27-commercial-internal-lots.sql
    └── 2026-08-03-production-stock-ledger.sql
```

`npm run db:production`:

1. valida o ambiente de produção;
2. cria o schema base apenas se a base estiver vazia;
3. aplica as migrações SQL ainda não registadas;
4. verifica o checksum de migrações já aplicadas;
5. cria o primeiro administrador apenas quando não existem utilizadores.

Não alterar retroativamente uma migração já aplicada. Qualquer alteração estrutural futura deve ser um novo ficheiro SQL numerado.

### Regras importantes de produção

- Não executar o seed de desenvolvimento na base real.
- Usar `npm run db:production` para preparar/aplicar a estrutura suportada em produção.
- Usar PINs de exatamente 8 algarismos.
- PINs não podem ser repetidos entre utilizadores.
- `SESSION_SECRET` deve ter pelo menos 32 caracteres.
- HTTPS é obrigatório.
- Confirmar `/api/health` depois de cada deploy.
- Fazer backup antes de alterações à aplicação ou base de dados.

## Scripts principais

```text
npm run dev                 Desenvolvimento local
npm run typecheck           Verificação TypeScript
npm run build               Build Next.js
npm run build:production    Validação + typecheck + build de produção
npm run verify:production   Validar variáveis do servidor
npm run db:seed             Seed opcional de desenvolvimento
npm run db:lots             Aplicar tabelas auxiliares de lotes/stock
npm run db:upgrade          Aplicar schema/migrações na BD configurada (útil em testes locais)
npm run db:production       Preparar/aplicar estrutura da BD em produção
npm run backup:db           Criar backup comprimido da BD
npm run pins:reset          Recuperar um PIN por terminal
npm start                   Arrancar através de app.js/server.cjs
```

## Estrutura

- `app/` — páginas, rotas e Server Actions.
- `components/` — componentes reutilizáveis.
- `lib/` — autenticação, acesso SQL, lotes, turnos, métricas e regras operacionais.
- `database/` — schema SQL e migrações versionadas.
- `scripts/` — preparação da BD, validação, recuperação e backups.
- `public/` — imagens e recursos estáticos.

A aplicação mantém-se em fase `0.9.x` até concluir a instalação e validação com utilização real no servidor de produção.
